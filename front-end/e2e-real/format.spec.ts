import { expect, test } from '@playwright/test';

/** A scripted turn and its build take a few seconds on the real back end. */
const TURN_TIMEOUT = 20_000;

test('CDK picks the format from the request, then the instructor changes it and rebuilds', async ({ page }) => {
  await page.goto('/?new=1');
  await page.getByLabel('Project title').fill('Lab safety orientation');
  await page.getByLabel('What should students learn or do?').fill('Create a lab safety lesson with separate student and instructor views.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  const eyebrow = page.locator('.workspace-eyebrow');
  const card = page.getByRole('article', { name: 'Ready to download' });
  await expect(eyebrow).toHaveText('Project · Content topic', { timeout: TURN_TIMEOUT });
  await expect(card.getByRole('link', { name: /download content topic/i })).toBeVisible({ timeout: TURN_TIMEOUT });
  await expect(page.getByLabel('Conversation history')).toContainText('I made this a content topic');

  const format = page.getByLabel('Format', { exact: true });
  await expect(format).toBeEnabled({ timeout: TURN_TIMEOUT });
  await format.selectOption('scorm');
  await page.getByRole('group', { name: 'Change format' }).getByRole('button', { name: 'Change format' }).click();
  await expect(eyebrow).toHaveText('Project · SCORM package');
  await expect(page.getByLabel('Describe a change')).toHaveValue('Rebuild this activity as a SCORM package.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(card).toContainText('Version 2', { timeout: TURN_TIMEOUT });
  await expect(card.getByRole('link', { name: 'Download SCORM package' })).toBeVisible();
});
