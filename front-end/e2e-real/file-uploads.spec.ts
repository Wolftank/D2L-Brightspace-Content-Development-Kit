import { expect, test } from '@playwright/test';

test('sends an attachment through B33 and resolves its saved label after reload', async ({ page }) => {
  await page.goto('/?new=1');
  await page.getByLabel('Project title').fill('File upload integration');
  await page.locator('input[type=file]').setInputFiles({ name: 'reference.txt', mimeType: 'text/plain', buffer: Buffer.from('Course reference without student data.') });
  await page.getByLabel('What should students learn or do?').fill('Create an activity using the reference.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const history = page.getByLabel('Conversation history');
  await expect(history.getByText('reference.txt', { exact: true })).toBeVisible();
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(history.getByText('reference.txt', { exact: true })).toBeVisible();
});
