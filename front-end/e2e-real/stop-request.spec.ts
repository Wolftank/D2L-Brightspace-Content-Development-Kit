import { expect, test } from '@playwright/test';

test('stops a scripted request on the real back end and builds a follow-up', async ({ page }) => {
  await page.goto('/?new=1');
  await page.getByLabel('Project title').fill('Stop request integration');
  await page.getByLabel('What should students learn or do?').fill('[long-step] Create a workplace safety practice set.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByLabel('Request progress')).toContainText('Building from the SCORM starter');
  await page.getByRole('button', { name: 'Stop request' }).click();
  const history = page.getByLabel('Conversation history');
  await expect(history.getByText('Request stopped.', { exact: true })).toBeVisible();
  await expect(page.getByText('No build yet.')).toBeVisible();
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(history.getByText('Request stopped.', { exact: true })).toBeVisible();
  await page.getByLabel('Describe a change').fill('Create a shorter workplace safety practice set.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ready to download' })).toBeVisible({ timeout: 15_000 });
  await expect(history.getByText('Request stopped.', { exact: true })).toHaveCount(1);
});
