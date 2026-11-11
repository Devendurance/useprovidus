import { expect, test } from "@playwright/test";

const viewports = [
  { width: 320, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1365, height: 900 },
];

test("dashboard brings the assistant forward and keeps receipt access honest across widths", async ({ page }) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect(page.getByRole("heading", { name: "Ask. Approve. Prove." })).toBeVisible();
    await expect(page.locator("section[aria-label=\"Supported payment networks\"] li")).toHaveCount(2);
    await expect(page.getByText("BOT Chain Mainnet · chain ID 677 · Native BOT and official USDT")).toBeVisible();
    await expect(page.getByRole("link", { name: "View receipts" })).toHaveAttribute("href", "/receipt");
    await expect(page.getByText("No payment history yet", { exact: true })).toHaveCount(0);

    const dimensions = await page.evaluate(() => {
      const assistant = document.querySelector("section[aria-label=\"Conversational assistant\"]");
      if (!assistant) throw new Error("Assistant section is missing");
      return {
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        assistantTop: Math.round(assistant.getBoundingClientRect().top + window.scrollY),
      };
    });
    expect(dimensions.document, `document overflow at ${viewport.width}px`).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.body, `body overflow at ${viewport.width}px`).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.assistantTop, `assistant is too far down at ${viewport.width}px`).toBeLessThan(650);

    if (viewport.width === 390) {
      await page.screenshot({ path: "output/playwright/p2-after-dashboard-mobile.png" });
    }
    if (viewport.width === 1365) {
      await page.screenshot({ path: "output/playwright/p2-after-dashboard-desktop.png" });
    }
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  const receiptLink = page.getByRole("link", { name: "View receipts" });
  await receiptLink.focus();
  const interaction = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) throw new Error("Receipt link did not receive focus");
    const style = getComputedStyle(active);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      transitionProperty: style.transitionProperty,
      targetHeight: active.getBoundingClientRect().height,
    };
  });
  expect(interaction.outlineStyle).toBe("solid");
  expect(interaction.outlineWidth).toBe("2px");
  expect(interaction.transitionProperty).toBe("none");
  expect(interaction.targetHeight).toBeGreaterThanOrEqual(44);
});
