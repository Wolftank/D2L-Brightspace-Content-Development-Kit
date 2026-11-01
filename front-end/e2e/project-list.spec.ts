import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('startup with no projects opens creation', async ({ page }) => {
  await page.route('**/api/projects', route => route.fulfill({ json: { items: [] } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Create an activity' })).toBeVisible();
  await expect(page.getByLabel('Project title')).toBeEditable();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('project list shows metadata, supports keyboard navigation, and fits a phone', async ({ page }, testInfo) => {
  await page.route('**/api/projects', route => route.fulfill({ json: { items: [
    { project: { id: 'newer', title: 'Recent activity', avenue: 'scorm', updatedAt: 1793500000000 }, latestBuild: { id: 'b2', version: 2, status: 'failed', createdAt: 1 } },
    { project: { id: 'older', title: 'Earlier activity', avenue: 'scorm', updatedAt: 1793400000000 }, latestBuild: null },
  ] } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'My projects' })).toBeVisible();
  const rows = page.getByRole('region', { name: 'Saved projects' }).getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Recent activity');
  await expect(rows.first()).toContainText('SCORM');
  await expect(rows.first()).toContainText('QA needs attention · Version 2');
  await expect(rows.last()).toContainText('No build yet');
  await expect(rows.first().locator('time')).toHaveAttribute('datetime', new Date(1793500000000).toISOString());
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('projects-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('projects-phone.png'), fullPage: true });
  await page.getByRole('link', { name: 'My projects', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'New project' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Create an activity' })).toBeVisible();
  await expect(page.getByLabel('Project title')).toBeEditable();
});

test('reopens an earlier project in a fresh session, continues it, and isolates drafts', async ({ page, browser }, testInfo) => {
  test.setTimeout(60_000);
  const title = 'F16 saved project ' + testInfo.project.name + ' ' + Date.now();
  await page.goto('/?new=1');
  await page.getByLabel('Project title').fill(title);
  await page.getByLabel('What should students learn or do?').fill('Create a practice quiz');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ready to download' })).toBeVisible({ timeout: 15_000 });
  const projectUrl = page.url();
  const fresh = await browser.newContext();
  try {
    const reopened = await fresh.newPage();
    await reopened.goto(new URL('/', projectUrl).href);
    const link = reopened.getByRole('link', { name: title, exact: true });
    await expect(link).toBeVisible();
    await link.focus();
    await reopened.keyboard.press('Enter');
    await expect(reopened.getByLabel('Conversation history')).toContainText('Create a practice quiz');
    await expect(reopened.getByTitle('Interactive preview of build 1')).toBeVisible({ timeout: 15_000 });
    await reopened.getByLabel('Describe a change').fill('Make it shorter');
    await reopened.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(reopened.getByText('Version 2', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(reopened.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    await reopened.getByLabel('Describe a change').fill('My saved draft');
    await reopened.getByRole('link', { name: 'My projects', exact: true }).click();
    await reopened.getByRole('link', { name: 'New project' }).click();
    await expect(reopened.getByLabel('What should students learn or do?')).toHaveValue('');
    await reopened.getByRole('link', { name: 'My projects', exact: true }).click();
    await reopened.getByRole('link', { name: title, exact: true }).click();
    await expect(reopened.getByLabel('Describe a change')).toHaveValue('My saved draft');
    await expect(reopened.getByTitle('Interactive preview of build 2')).toBeVisible();
  } finally { await fresh.close(); }
});
