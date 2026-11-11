import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const OWNER_A = "0x1111111111111111111111111111111111111111";
const OWNER_B = "0x2222222222222222222222222222222222222222";

type Memory = {
  id: string;
  kind: "fact" | "preference";
  label: string;
  value: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

async function installMockWallet(page: Page, initialOwner: string) {
  await page.addInitScript((address: string) => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    let accounts = [address];
    const provider = {
      isMetaMask: true,
      _state: {},
      _events: {},
      isConnected: () => true,
      on(event: string, listener: (...args: unknown[]) => void) {
        const group = listeners.get(event) ?? new Set();
        group.add(listener);
        listeners.set(event, group);
        return provider;
      },
      removeListener(event: string, listener: (...args: unknown[]) => void) {
        listeners.get(event)?.delete(listener);
        return provider;
      },
      removeAllListeners(event?: string) {
        if (event) listeners.delete(event);
        else listeners.clear();
        return provider;
      },
      setAccounts(next: string[]) {
        accounts = next;
        for (const listener of listeners.get("accountsChanged") ?? []) listener(next);
      },
      async request({ method }: { method: string }) {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return accounts;
        if (method === "eth_chainId") return "0xa4ec";
        if (method === "net_version") return "42220";
        if (method === "personal_sign" || method === "eth_sign") return `0x${"1".repeat(130)}`;
        if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
        throw new Error(`Unsupported mocked wallet method: ${method}`);
      },
    };
    Object.defineProperty(window, "ethereum", { configurable: true, value: provider });
  }, initialOwner);
}

async function installAuthenticatedApp(page: Page, owner: () => string) {
  await page.route("**/api/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, address: owner() }),
  }));
  await page.route("**/api/auth/challenge", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, message: "Mock SIWE challenge" }),
  }));
  await page.route("**/api/auth/verify", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, address: owner() }),
  }));
  await page.route("**/api/conversations?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, sessions: [], nextCursor: null }),
  }));
  await page.route("**/api/transfers?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, transfers: [] }),
  }));
  await page.route("**/api/transfers", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, transfers: [] }),
  }));
}

function ownerFor(route: Route): string {
  return (route.request().headers()["x-providus-wallet"] ?? OWNER_A).toLowerCase();
}

async function installMemoryApi(page: Page, entries = new Map<string, Memory[]>()) {
  await page.route("**/api/memories", async (route) => {
    const request = route.request();
    const owner = ownerFor(route);
    const rows = entries.get(owner) ?? [];
    if (request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, memories: rows }) });
      return;
    }
    if (request.method() === "POST") {
      const draft = request.postDataJSON() as Record<string, unknown>;
      expect(draft).not.toHaveProperty("ownerAddress");
      expect(Object.keys(draft).sort()).toEqual(["kind", "label", "requestId", "value"]);
      const now = "2026-11-10T10:00:00.000Z";
      const memory: Memory = {
        id: `mem_${owner.slice(2, 8)}`,
        kind: draft.kind as Memory["kind"],
        label: draft.label as string,
        value: draft.value as string,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      entries.set(owner, [...rows, memory]);
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, memory }) });
      return;
    }
    await route.fulfill({ status: 405, contentType: "application/json", body: JSON.stringify({ ok: false }) });
  });

  await page.route("**/api/memories/*", async (route) => {
    const request = route.request();
    const owner = ownerFor(route);
    const rows = entries.get(owner) ?? [];
    const id = new URL(request.url()).pathname.split("/").at(-1) ?? "";
    const index = rows.findIndex((row) => row.id === id);
    if (request.method() === "PATCH" && index >= 0) {
      const patch = request.postDataJSON() as Omit<Memory, "id" | "createdAt" | "updatedAt">;
      const previous = rows[index];
      const memory = { ...previous, ...patch, version: previous.version + 1, updatedAt: "2026-11-10T10:02:00.000Z" };
      entries.set(owner, rows.map((row, rowIndex) => rowIndex === index ? memory : row));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, memory }) });
      return;
    }
    if (request.method() === "DELETE" && index >= 0) {
      expect(request.postDataJSON()).toEqual({ expectedVersion: rows[index].version });
      entries.set(owner, rows.filter((row) => row.id !== id));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "Memory not found." } }) });
  });
  return entries;
}

async function openDashboard(page: Page, expectedOwner: string) {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Providus Assistant" }).last()).toBeVisible();
  await expect(page.getByText(`Connected wallet ${expectedOwner}`, { exact: true })).toBeVisible();
  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  if (await signIn.isVisible()) {
    await signIn.click();
    await expect(page.getByText("Wallet verified", { exact: true })).toBeVisible({ timeout: 20_000 });
  }
}

test("memory can be explicitly added, explained, edited, and deleted", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await installMockWallet(page, OWNER_A);
  await installAuthenticatedApp(page, () => OWNER_A);
  const entries = await installMemoryApi(page);
  await openDashboard(page, OWNER_A);

  const trigger = page.getByRole("button", { name: "Manage shared memory" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Saved memory" });
  await expect(dialog.getByText("Nothing saved for future chats")).toBeVisible();
  await dialog.getByRole("button", { name: "Add a memory" }).click();
  await dialog.getByLabel("Type").selectOption("preference");
  await dialog.getByLabel("Name this memory").fill("Preferred network");
  await dialog.getByLabel("What should Providus remember?").fill("I prefer Celo for suggestions. Ask me to confirm each payment.");
  await dialog.getByRole("button", { name: "Save for future chats" }).click();

  await expect(dialog.getByRole("heading", { name: "Preferred network" })).toBeVisible();
  await expect(dialog.getByText("Saved for future conversations.")).toBeVisible();
  await dialog.getByText("Why is this remembered?").click();
  await expect(dialog.getByText(/You chose to save this/)).toBeVisible();
  await expect(dialog.getByText(/It never approves or sends a payment/)).toBeVisible();

  mkdirSync(path.resolve(process.cwd(), "output", "playwright"), { recursive: true });
  await page.screenshot({ path: path.resolve(process.cwd(), "output", "playwright", "p1.2-memory-mobile.png"), fullPage: false });
  for (const width of [320, 375, 390, 768, 1365]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `No horizontal overflow at ${width}px`).toBe(false);
    const dialogOverflow = await dialog.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(dialogOverflow, `Memory dialog fits at ${width}px`).toBe(false);
  }
  await page.screenshot({ path: path.resolve(process.cwd(), "output", "playwright", "p1.2-memory-desktop.png"), fullPage: false });

  await dialog.getByRole("button", { name: "Edit Preferred network" }).click();
  await dialog.getByLabel("What should Providus remember?").fill("Ask whether I want Celo before creating a payment intent.");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByText("Ask whether I want Celo before creating a payment intent.")).toBeVisible();
  await dialog.getByRole("button", { name: "Delete Preferred network" }).click();
  await expect(dialog.getByText("Remove this from future chats? Past conversation messages will remain.")).toBeVisible();
  await dialog.getByRole("button", { name: "Remove memory" }).click();
  await expect(dialog.getByRole("heading", { name: "Preferred network" })).toHaveCount(0);
  expect(entries.get(OWNER_A.toLowerCase())).toEqual([]);
});

test("memory dialog closes with Escape and outside click and restores focus", async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 900 });
  await installMockWallet(page, OWNER_A);
  await installAuthenticatedApp(page, () => OWNER_A);
  await installMemoryApi(page);
  await openDashboard(page, OWNER_A);

  const trigger = page.getByRole("button", { name: "Manage shared memory" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Saved memory" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close saved memory" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(6, 6);
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("wallet changes clear old memory and ignore the stale owner response", async ({ page }) => {
  let currentOwner = OWNER_A;
  let releaseOldResponse = () => {};
  let notifyOldRequest = () => {};
  const oldStarted = new Promise<void>((resolve) => { notifyOldRequest = resolve; });
  const oldGate = new Promise<void>((resolve) => { releaseOldResponse = resolve; });
  await page.setViewportSize({ width: 375, height: 812 });
  await installMockWallet(page, OWNER_A);
  await installAuthenticatedApp(page, () => currentOwner);
  await page.route("**/api/memories", async (route) => {
    const owner = ownerFor(route);
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 405, body: "" });
      return;
    }
    if (owner === OWNER_A.toLowerCase()) {
      notifyOldRequest();
      await oldGate;
      try {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, memories: [{
            id: "mem_owner_a",
            kind: "fact",
            label: "Old owner only",
            value: "This stale memory must disappear.",
            version: 1,
            createdAt: "2026-11-10T10:00:00.000Z",
            updatedAt: "2026-11-10T10:00:00.000Z",
          }] }),
        });
      } catch {
        return;
      }
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, memories: [{
        id: "mem_owner_b",
        kind: "fact",
        label: "New owner only",
        value: "This belongs to the new wallet.",
        version: 1,
        createdAt: "2026-11-10T10:00:00.000Z",
        updatedAt: "2026-11-10T10:00:00.000Z",
      }] }),
    });
  });
  await openDashboard(page, OWNER_A);
  await page.getByRole("button", { name: "Manage shared memory" }).click();
  await oldStarted;
  currentOwner = OWNER_B;
  await page.evaluate((nextOwner) => {
    const browserWindow = window as unknown as {
      ethereum: { setAccounts(accounts: string[]): void };
    };
    const provider = browserWindow.ethereum;
    provider.setAccounts([nextOwner]);
  }, OWNER_B);
  const dialog = page.getByRole("dialog", { name: "Saved memory" });
  await expect(dialog).toBeHidden();
  releaseOldResponse();
  await page.getByRole("button", { name: "Manage shared memory" }).click();
  await expect(dialog.getByText("Sign in with the connected wallet to manage memory shared across its conversations.")).toBeVisible();
  await expect(dialog.getByText("This stale memory must disappear.")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close saved memory" }).click();
  await page.getByRole("button", { name: "Sign in again", exact: true }).click();
  await expect(page.getByText("Wallet verified", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Manage shared memory" }).click();
  await expect(dialog.getByRole("heading", { name: "New owner only" })).toBeVisible();
  await expect(dialog.getByText("This stale memory must disappear.")).toHaveCount(0);
});
