import { expect, test } from "@playwright/test";

const OWNER = "0x1111111111111111111111111111111111111111";
const SESSION_ID = "018f0000-0000-7000-8000-000000000001";
const SESSION = {
  id: SESSION_ID,
  title: "Gas reimbursement",
  titleSource: "automatic" as const,
  createdAt: "2026-11-10T10:00:00.000Z",
  updatedAt: "2026-11-10T10:02:00.000Z",
  lastMessageAt: "2026-11-10T10:02:00.000Z",
};

async function installMockWallet(page: import("@playwright/test").Page) {
  await page.addInitScript((address: string) => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
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
      async request({ method }: { method: string }) {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
        if (method === "eth_chainId") return "0xa4ec";
        if (method === "net_version") return "42220";
        if (method === "personal_sign" || method === "eth_sign") return `0x${"1".repeat(130)}`;
        if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
        throw new Error(`Unsupported mocked wallet method: ${method}`);
      },
    };
    Object.defineProperty(window, "ethereum", { configurable: true, value: provider });
  }, OWNER);
}

async function mockAuthenticatedConversationApi(page: import("@playwright/test").Page) {
  await page.route("**/api/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, address: OWNER }),
  }));
  await page.route("**/api/auth/challenge", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, message: "Mock SIWE challenge" }),
  }));
  await page.route("**/api/auth/verify", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, address: OWNER }),
  }));
  await page.route("**/api/conversations?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, sessions: [SESSION], nextCursor: null }),
  }));
  await page.route(`**/api/conversations/${SESSION_ID}`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      session: SESSION,
      olderBeforeSequence: null,
      messages: [
        {
          id: "018f0000-0000-7000-8000-000000000011",
          sessionId: SESSION_ID,
          turnId: "018f0000-0000-7000-8000-000000000021",
          sequence: 1,
          role: "user",
          content: "What is 10% of 20 BOT?",
          timestamp: "2026-11-10T10:01:00.000Z",
          turnStatus: "complete",
        },
        {
          id: "018f0000-0000-7000-8000-000000000012",
          sessionId: SESSION_ID,
          turnId: "018f0000-0000-7000-8000-000000000021",
          sequence: 2,
          role: "assistant",
          content: "10% of 20 BOT is 2 BOT.",
          timestamp: "2026-11-10T10:02:00.000Z",
        },
      ],
    }),
  }));
}

const viewports = [
  { width: 320, height: 800, name: "320" },
  { width: 375, height: 812, name: "375" },
  { width: 390, height: 844, name: "390" },
  { width: 768, height: 1024, name: "768" },
  { width: 1365, height: 900, name: "desktop" },
];

test("conversation history layout stays within the viewport", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Providus Assistant" }).last()).toBeVisible();
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(() => window.scrollTo(0, 0));
    if (viewport.width < 768) {
      await expect(page.getByRole("button", { name: "Open conversation history" })).toBeVisible();
    } else {
      await expect(page.getByRole("complementary", { name: "Conversation history" })).toBeVisible();
    }
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(dimensions.document, `document overflow at ${viewport.name}px`).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.body, `body overflow at ${viewport.name}px`).toBeLessThanOrEqual(dimensions.viewport);
    await page.screenshot({ path: `output/playwright/p1.1-assistant-${viewport.name}.png`, fullPage: false });
  }
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.getByRole("heading", { name: "Providus Assistant" }).last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: "output/playwright/p1.1-assistant-desktop-panel.png", fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "Providus Assistant" }).last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: "output/playwright/p1.1-assistant-mobile-panel-390.png", fullPage: false });
});

test("mobile conversation drawer supports focus, Escape, outside close, and scroll lock", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  const trigger = page.getByRole("button", { name: "Open conversation history" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Conversation history" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close conversation history" })).toBeFocused();
  await page.screenshot({ path: "output/playwright/p1.1-assistant-mobile-drawer-390.png", fullPage: false });
  await expect.poll(() => page.locator("body").evaluate((element) => (element as HTMLElement).style.overflow)).toBe("hidden");

  const focusables = dialog.locator("button:not([disabled]), input:not([disabled])");
  const count = await focusables.count();
  await focusables.nth(count - 1).focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close conversation history" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.locator("body").evaluate((element) => (element as HTMLElement).style.overflow)).toBe("");

  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(380, 500);
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("authenticated user can restore a saved conversation without restoring payment authorization", async ({ page }) => {
  await installMockWallet(page);
  await mockAuthenticatedConversationApi(page);
  await page.goto("/dashboard");
  await expect(page.getByText("Connected wallet " + OWNER, { exact: true })).toBeVisible();
  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  await expect(signIn).toBeVisible();
  await signIn.click();
  await expect(page.getByText("Wallet verified", { exact: true })).toBeVisible({ timeout: 20_000 });

  const conversation = page.getByRole("button", { name: /Gas reimbursement/ }).first();
  await expect(conversation).toBeVisible();
  await conversation.click();
  await expect(page.getByText("What is 10% of 20 BOT?", { exact: true })).toBeVisible();
  await expect(page.getByText("10% of 20 BOT is 2 BOT.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve allowance|Approve payment|Confirm in wallet|Retry gas estimate/i })).toHaveCount(0);
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.getByRole("heading", { name: "Providus Assistant" }).last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: "output/playwright/p1.1-assistant-restored-chat-desktop.png", fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "Providus Assistant" }).last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: "output/playwright/p1.1-assistant-restored-chat-390.png", fullPage: false });
});
