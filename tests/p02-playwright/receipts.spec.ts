import { expect, test, type Page } from "@playwright/test";

const preview = {
  id: "bot:demo-intent",
  source: "bot",
  createdAt: "2026-11-10T12:00:00.000Z",
  network: "BOT Chain Mainnet",
  networkKey: "bot-mainnet",
  chainId: 677,
  token: "USDT",
  amount: "12.5",
  recipientName: "Ada Lovelace",
  recipientAddress: "0x1234567890abcdef1234567890abcdef12345678",
  status: "verified",
  txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  explorerUrl: "https://scan.botchain.ai/tx/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  verifiedAt: "2026-11-10T12:01:00.000Z",
};

const detail = {
  ...preview,
  payerAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  paymentContract: "0xcccccccccccccccccccccccccccccccccccccccc",
  tokenContract: "0xdddddddddddddddddddddddddddddddddddddddd",
  blockNumber: 123456,
  confirmationCount: 12,
  actualGasFee: null,
  receiptTimestamp: "2026-11-10T12:00:30.000Z",
  statusEvidence: "B5 confirmed and verified",
};

async function mockReceipts(page: Page) {
  await page.route("**/api/receipts**", async (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    if (pathname.startsWith("/api/receipts/")) {
      await route.fulfill({ json: { ok: true, receipt: detail } });
    } else {
      await route.fulfill({ json: { ok: true, receipts: [preview], nextCursor: null } });
    }
  });
}
const viewports = [
  { width: 320, height: 800, name: "320" },
  { width: 375, height: 812, name: "375" },
  { width: 390, height: 844, name: "390" },
  { width: 768, height: 1024, name: "768" },
  { width: 1365, height: 900, name: "desktop" },
];

test("receipt and header layouts reflow without horizontal overflow", async ({ page }) => {
  await mockReceipts(page);
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/receipt");
    await expect(page.getByRole("heading", { name: "Your receipts" })).toBeVisible();
    await expect(page.getByRole("button", { name: /View receipt/ })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(dimensions.document, `document overflow at ${viewport.name}px`).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.body, `body overflow at ${viewport.name}px`).toBeLessThanOrEqual(dimensions.viewport);
    await page.screenshot({ path: `output/playwright/p0.2-after-receipt-${viewport.name}.png`, fullPage: true });
  }
});

test("mobile navigation supports keyboard, Escape, outside click, route close, and scroll lock", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(() => window.scrollTo(0, 500));
  const initialScroll = await page.evaluate(() => window.scrollY);
  const toggle = page.getByRole("button", { name: "Open navigation menu" });
  await toggle.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Site navigation" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close navigation menu" })).toBeFocused();
  await expect.poll(() => page.locator("body").evaluate((element) => getComputedStyle(element).position)).toBe("fixed");
  await page.screenshot({ path: "output/playwright/p0.2-after-nav-open-390.png", fullPage: false });

  await dialog.getByRole("navigation", { name: "Mobile" }).getByRole("link", { name: "Try Providus" }).focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close navigation menu" })).toBeFocused();
  await page.mouse.move(350, 500);
  const lockedTop = await page.locator("body").evaluate((element) => (element as HTMLElement).style.top);
  expect(lockedTop).toBe(`-${initialScroll}px`);
  await page.mouse.wheel(0, 500);
  expect(await page.locator("body").evaluate((element) => (element as HTMLElement).style.top)).toBe(lockedTop);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(initialScroll);

  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(4, 700);
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/\/how-it-works$/);
  await expect(dialog).toBeHidden();
});

test("receipt dialog closes with X, Escape, and outside click, trapping and restoring focus", async ({ page }) => {
  await mockReceipts(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/receipt");
  const trigger = page.getByRole("button", { name: /View receipt/ });
  const dialogElement = page.locator("dialog[aria-labelledby=receipt-dialog-title]");
  const detailRequestPromise = page.waitForRequest((request) => new URL(request.url()).pathname.startsWith("/api/receipts/"), { timeout: 10000 });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const detailRequest = await detailRequestPromise;
  expect(decodeURIComponent(new URL(detailRequest.url()).pathname)).toBe("/api/receipts/bot:demo-intent");

  const dialog = page.getByRole("dialog", { name: "Payment receipt" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("B5 confirmed and verified")).toBeVisible();
  await expect(dialog.getByText("Unavailable in the stored record")).toBeVisible();
  await page.screenshot({ path: "output/playwright/p0.2-after-receipt-detail-desktop.png", fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileModalDimensions = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(mobileModalDimensions.document).toBeLessThanOrEqual(mobileModalDimensions.viewport);
  expect(mobileModalDimensions.body).toBeLessThanOrEqual(mobileModalDimensions.viewport);
  await page.screenshot({ path: "output/playwright/p0.2-after-receipt-detail-mobile-390.png", fullPage: false });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(dialog.getByRole("link", { name: "Open transaction explorer" })).toHaveAttribute("href", /scan\.botchain\.ai/);

  const close = dialog.getByRole("button", { name: "Close receipt" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("link", { name: "Open transaction explorer" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await expect(close).toBeVisible();
  await expect(close).toBeEnabled();
  await expect(dialogElement).toHaveJSProperty("open", true);
  await close.click();
  await expect(dialogElement).toHaveJSProperty("open", false);
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});