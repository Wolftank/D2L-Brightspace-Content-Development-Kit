import { expect, test } from '@playwright/test';

test('the home link scrolls into view when it gets focus while the page is scrolled down (#148)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto('/?new=1');
  const home = page.getByRole('link', { name: 'D2L Content Development Kit home' });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(home).not.toBeInViewport();

  // Focus without the browser's own scroll, as Firefox does when Tab wraps into the page from its toolbar.
  await home.evaluate((link: HTMLElement) => link.focus({ preventScroll: true }));

  await expect(home).toBeFocused();
  await expect(home).toBeInViewport();
});
