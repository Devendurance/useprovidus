import { expect, test } from "@playwright/test";

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
