import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('picks and drops files, refuses an unsupported file, and restores sent labels after reload', async ({ page }) => {
  await page.goto('/?new=1');
  await page.getByLabel('Project title').fill('Attachment practice');
  const attach = page.getByRole('button', { name: 'Attach files' });
  await attach.focus();
  const chooserEvent = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooserEvent).setFiles([
    { name: 'syllabus.txt', mimeType: 'text/plain', buffer: Buffer.from('Course syllabus') },
    { name: 'remove.txt', mimeType: 'text/plain', buffer: Buffer.from('Unused notes') },
    { name: 'unsupported.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') },
  ]);
  await expect(page.getByRole('alert').filter({ hasText: 'unsupported.gif' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove remove.txt' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('remove.txt', { exact: true })).toHaveCount(0);
  const dropData = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['Assignment reference'], 'assignment.txt', { type: 'text/plain' }));
    return transfer;
  });
  await page.locator('main').dispatchEvent('dragenter', { dataTransfer: dropData });
  await expect(page.getByText('Drop files to attach')).toBeVisible();
  await page.locator('main').dispatchEvent('drop', { dataTransfer: dropData });
  await expect(page.getByText('Drop files to attach')).toHaveCount(0);
  await expect(page).toHaveURL(/\?new=1$/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByLabel('What should students learn or do?').fill('Use both references.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const history = page.getByLabel('Conversation history');
  await expect(history.getByText('assignment.txt', { exact: true })).toBeVisible();
  await expect(history.getByText('syllabus.txt', { exact: true })).toBeVisible();
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(history.getByText('assignment.txt', { exact: true })).toBeVisible();
  await expect(history.getByText('syllabus.txt', { exact: true })).toBeVisible();
});

test('keeps the message and attachment when the server refuses the uploaded content', async ({ page }) => {
  await page.goto('/?new=1');
  await page.getByLabel('Project title').fill('Refused attachment');
  await page.locator('input[type=file]').setInputFiles({ name: 'invalid.pdf', mimeType: 'application/pdf', buffer: Buffer.from([0, 255, 0, 255]) });
  await page.getByLabel('What should students learn or do?').fill('Keep this text.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not upload invalid.pdf' })).toContainText('Your message was not sent.');
  await expect(page.getByLabel('Describe a change')).toHaveValue('Keep this text.');
  await expect(page.getByRole('button', { name: 'Remove invalid.pdf' })).toBeEnabled();
  await expect(page.getByLabel('Conversation history')).toBeHidden();
});
