import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('a signed-out instructor signs in from the Design panel and can send again', async ({ page }) => {
  await page.goto('/?new=1');
  await page.getByLabel('Project title').fill('Sign-in');
  await page.getByLabel('What should students learn or do?').fill('[signed-out] Create a quiz');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const chat = page.getByLabel('Conversation history');
  await expect(chat.getByRole('alert')).toContainText("isn't signed in", { timeout: 15_000 });
  await expect(chat.getByRole('button', { name: 'Sign in to Claude' })).toBeVisible();

  await page.reload();
  const notice = page.locator('.sign-in-notice');
  await expect(notice.getByRole('status')).toHaveText('Sign in to Claude to send requests.');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  const scan = await new AxeBuilder({ page }).include('.sign-in-notice').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(scan.violations).toEqual([]);

  await notice.getByRole('button', { name: 'Sign in to Claude' }).click();
  await expect(notice.getByRole('status')).toHaveText('Finish signing in in your browser, then press Check again.');
  await notice.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Describe a change')).toBeFocused();
});
