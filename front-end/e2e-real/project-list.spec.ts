import { expect, test } from '@playwright/test';

test('saved projects survive a fresh browser session on the real back end', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const title = 'F16 real saved project ' + Date.now();
  await page.goto('/?new=1');
  await page.getByLabel('Project title').fill(title);
  await page.getByLabel('What should students learn or do?').fill('Create a workplace safety practice set.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ready to download' })).toBeVisible({ timeout: 20_000 });
  const origin = new URL(page.url()).origin;
  const fresh = await browser.newContext();
  try {
    const reopened = await fresh.newPage();
    await reopened.goto(origin);
    const link = reopened.getByRole('link', { name: title, exact: true });
    await expect(link).toBeVisible();
    await link.click();
    await expect(reopened.getByLabel('Conversation history')).toContainText('Create a workplace safety practice set.');
    await expect(reopened.getByTitle('Interactive preview of build 1')).toBeVisible({ timeout: 20_000 });
    await reopened.getByLabel('Describe a change').fill('[follow-up] Add two more questions.');
    await reopened.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(reopened.getByText('Version 2', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(reopened.getByTitle('Interactive preview of build 2')).toBeVisible();
    await reopened.getByRole('link', { name: 'My projects', exact: true }).click();
    const row = reopened.getByRole('listitem').filter({ has: reopened.getByRole('link', { name: title, exact: true }) });
    await expect(row).toContainText('Ready · Version 2');
  } finally { await fresh.close(); }
});
