const { test, expect } = require("playwright/test");

const WEB_URL = process.env.WEB_URL || "https://prive-deal-finder-web-ocita6cjaa-ue.a.run.app";
const TEST_EMAIL = process.env.UX_TEST_EMAIL || "admin@privegroup.com";

test.describe("Prive Deal Finder UX smoke (prod)", () => {
  test.setTimeout(120000);

  test("email login, deals, reports, integrations", async ({ page }) => {
    await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Login" })).toBeVisible();
    await page.waitForTimeout(2500);

    await page.locator('input[type="email"]').fill(TEST_EMAIL);
    await page.getByRole("button", { name: "Continue with Email" }).click();

    await expect(page.getByRole("heading", { name: "Deals" })).toBeVisible({ timeout: 30000 });
    await expect(page).toHaveURL(/\/deals/);

    const firstDealLink = page.locator("tbody tr td a").first();
    await expect(firstDealLink).toBeVisible({ timeout: 15000 });
    await firstDealLink.click();

    await page.waitForURL(/\/deals\/.+/, { timeout: 30000 });
    await expect(page.getByRole("heading", { name: "Owners" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Property Facts" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Gallery" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Map & Street View" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Comparables" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Recompute Comps" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Recompute Insights" })).toBeVisible();

    await page.goto(`${WEB_URL}/reports`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Pipeline Report" })).toBeVisible();
    await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 15000 });

    await page.goto(`${WEB_URL}/settings/integrations`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();

    const dialogMessages = [];
    page.on("dialog", async (dialog) => {
      dialogMessages.push(dialog.message());
      await dialog.dismiss();
    });

    const integrationsTable = page.locator("table").first();

    const mdpaRow = integrationsTable.locator("tbody tr", { hasText: "mdpa" }).first();
    await expect(mdpaRow).toBeVisible({ timeout: 15000 });
    await mdpaRow.getByRole("button", { name: "Sync" }).click();

    await expect(page.locator("main").getByText(/canceled by user/i).first()).toBeVisible({ timeout: 15000 });
    expect(dialogMessages.length).toBeGreaterThan(0);

    const browardRow = integrationsTable.locator("tbody tr", { hasText: "broward-parcels" }).first();
    await expect(browardRow).toBeVisible({ timeout: 15000 });
    await browardRow.getByRole("button", { name: "Sync" }).click();

    await expect(page.getByText(/runId:/i)).toBeVisible({ timeout: 40000 });
  });
});
