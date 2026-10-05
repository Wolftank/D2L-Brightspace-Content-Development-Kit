import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const size of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'phone', width: 390, height: 844 }]) {
  test(`long feed follows and pauses without page growth at ${size.name} size`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.getByLabel('Project title').fill('Long feed');
    await page.getByLabel('What should students learn or do?').fill('[long-feed] Build a quiz');
    await page.getByRole('button', { name: 'Build activity' }).click();
    const feed = page.getByRole('log', { name: 'Build progress' });
    await expect(feed.getByRole('listitem').filter({ hasText: 'Checking activity 15:' })).toHaveCount(1);
    const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const geometry = () => feed.evaluate((element) => ({ top: element.scrollTop, height: element.scrollHeight, client: element.clientHeight }));
    let bounds = await geometry();
    expect(Math.abs(bounds.height - bounds.client - bounds.top)).toBeLessThanOrEqual(4);
    await page.getByRole('link', { name: 'D2L Content Development Kit home' }).focus();
    await page.keyboard.press('Tab');
    await expect(feed).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
    await expect.poll(async () => (await geometry()).top).toBe(0);
    const position = (await geometry()).top;
    const pagePosition = await page.evaluate(() => window.scrollY);
    await expect(feed.getByRole('listitem').filter({ hasText: 'Checking activity 25:' })).toHaveCount(1);
    expect((await geometry()).top).toBe(position);
    expect(await page.evaluate(() => window.scrollY)).toBe(pagePosition);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(documentHeight);
    await page.getByRole('button', { name: 'Jump to latest' }).click();
    await expect(page.getByRole('button', { name: 'Jump to latest' })).toHaveCount(0);
    await expect(feed.getByRole('listitem').filter({ hasText: 'Checking activity 60:' })).toHaveCount(1, { timeout: 10_000 });
    bounds = await geometry();
    expect(Math.abs(bounds.height - bounds.client - bounds.top)).toBeLessThanOrEqual(4);
    expect(await feed.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await feed.focus();
    await page.keyboard.press('Home');
    await expect(page.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
    await page.keyboard.press('End');
    await expect(page.getByRole('button', { name: 'Jump to latest' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Ready to download' })).toBeVisible({ timeout: 10_000 });
    expect(await feed.evaluate((element) => getComputedStyle(element).scrollBehavior)).toBe('auto');
    const accessibility = await new AxeBuilder({ page }).withRules(['scrollable-region-focusable']).analyze();
    expect(accessibility.violations).toEqual([]);
  });
}
