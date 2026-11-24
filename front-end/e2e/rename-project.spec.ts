import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('the instructor renames a project from the open project and from the list', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const base = 'F18 ' + testInfo.project.name + ' ' + Date.now();
  await page.goto('/?new=1');
  await page.getByLabel('Project title').fill(base + ' divison');
  await page.getByLabel('What should students learn or do?').fill('Create a practice quiz.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ready to download' })).toBeVisible({ timeout: 15_000 });

  const heading = page.getByRole('heading', { level: 1 });
  const quill = page.getByRole('button', { name: 'Rename project' });
  const field = page.getByRole('textbox', { name: 'Project title' });

  // Esc cancels and leaves the title as it was.
  await quill.click();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(base + ' divison');
  await expect(quill).toBeHidden();
  expect((await new AxeBuilder({ page }).include('.intro').analyze()).violations).toEqual([]);
  await field.fill('Something else');
  await page.keyboard.press('Escape');
  await expect(heading).toHaveText(base + ' divison');
  await expect(quill).toBeFocused();

  // The X button cancels too.
  await page.keyboard.press('Enter');
  await field.fill('Something else');
  await page.getByRole('button', { name: 'Cancel rename' }).click();
  await expect(heading).toHaveText(base + ' divison');
  await expect(quill).toBeFocused();

  // A blank title is refused and the field stays open for a fix, then Enter saves.
  await page.keyboard.press('Enter');
  await field.fill('   ');
  await page.getByRole('button', { name: 'Save title' }).click();
  await expect(page.getByText('Enter a title for the project.')).toBeVisible();
  await expect(field).toBeFocused();
  await field.fill(base + ' division');
  await page.keyboard.press('Enter');
  await expect(heading).toHaveText(base + ' division');
  await expect(quill).toBeFocused();
  expect((await new AxeBuilder({ page }).include('.intro').analyze()).violations).toEqual([]);

  // A later download is named after the new title.
  const href = await page.getByRole('article', { name: 'Ready to download' }).getByRole('link', { name: /^Download/ }).getAttribute('href');
  const download = await page.request.get(href!);
  const slug = (base + ' division').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  expect(download.headers()['content-disposition']).toBe(`attachment; filename="${slug}-v1.zip"`);

  // The list shows the new title, and the check button saves a rename from there.
  await page.getByRole('link', { name: 'My projects', exact: true }).click();
    // Find the row once by its place in the list, since its link turns into the field while it is renamed.
  const rows = page.getByRole('region', { name: 'Saved projects' }).getByRole('listitem');
  await expect(rows.filter({ has: page.getByRole('link', { name: base + ' division', exact: true }) })).toBeVisible();
  const index = await rows.evaluateAll((items, title) => items.findIndex(item => item.querySelector('h2')?.textContent === title), base + ' division');
  const row = rows.nth(index);
  await row.getByRole('button', { name: 'Rename project' }).click();
  await expect(row.getByRole('textbox', { name: 'Project title' })).toBeFocused();
  await row.getByRole('textbox', { name: 'Project title' }).fill(base + ' mitosis');
  await row.getByRole('button', { name: 'Save title' }).click();
  await expect(row.getByRole('link', { name: base + ' mitosis', exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Rename project' })).toBeFocused();

  // Both places keep the new title after a reload.
  await page.reload();
  const renamedLink = page.getByRole('link', { name: base + ' mitosis', exact: true });
  await expect(renamedLink).toBeVisible();
  await renamedLink.click();
  await expect(heading).toHaveText(base + ' mitosis');
  await page.reload();
  await expect(heading).toHaveText(base + ' mitosis');
});

test('the rename controls fit a phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?new=1');
  await page.getByLabel('Project title').fill('F18 phone ' + testInfo.project.name + ' ' + Date.now() + ' with a long title that wraps');
  await page.getByLabel('What should students learn or do?').fill('Create a practice quiz.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Rename project' }).click();
  await expect(page.getByRole('button', { name: 'Save title' })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Cancel rename' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('rename-phone.png'), fullPage: true });
});
