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

test('a renamed project keeps its new title in a fresh browser session and names its download after it', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const stamp = Date.now();
  await page.goto('/?new=1');
  await page.getByLabel('Project title').fill('F18 real project ' + stamp + ' draft');
  await page.getByLabel('What should students learn or do?').fill('Create a workplace safety practice set.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ready to download' })).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Rename project' }).click();
  await page.getByRole('textbox', { name: 'Project title' }).fill('  F18 real project ' + stamp + ' final  ');
  await page.keyboard.press('Enter');
  const title = 'F18 real project ' + stamp + ' final';
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);

  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('article', { name: 'Ready to download' }).getByRole('link', { name: 'Download SCORM package' }).click();
  expect((await downloadEvent).suggestedFilename()).toBe(`f18-real-project-${stamp}-final-v1.zip`);

  const fresh = await browser.newContext();
  try {
    const reopened = await fresh.newPage();
    await reopened.goto(new URL(page.url()).origin);
    const link = reopened.getByRole('link', { name: title, exact: true });
    await expect(link).toBeVisible();
    await link.click();
    await expect(reopened.getByRole('heading', { level: 1 })).toHaveText(title);
  } finally { await fresh.close(); }
});
