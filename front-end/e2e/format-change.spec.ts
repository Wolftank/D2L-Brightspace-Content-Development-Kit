import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('the instructor changes the format of a built project and rebuilds it', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?new=1');
  await page.getByLabel('Project title').fill('Cell division practice');
  await page.getByLabel('What should students learn or do?').fill('Create a practice quiz.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  const format = page.getByLabel('Format', { exact: true });
  await expect(format).toBeDisabled();
  await expect(format).toHaveValue('auto');
  await expect(page.getByRole('heading', { name: 'Ready to download' })).toBeVisible({ timeout: 15_000 });
  await expect(format).toBeEnabled();
  await expect(format).toHaveValue('scorm');
  await expect(format.getByRole('option')).toHaveText(['SCORM package', 'Content topic']);

  await format.selectOption('topic');
  const confirmation = page.getByRole('group', { name: 'Change format' });
  await expect(confirmation).toContainText("Change to Content topic? The activity starts over in that format. Work that isn't in a version yet is lost.");
  expect((await new AxeBuilder({ page }).include('.intro').analyze()).violations).toEqual([]);
  await confirmation.getByRole('button', { name: 'Change format' }).click();

  await expect(page.locator('.workspace-eyebrow')).toHaveText('Project · Content topic');
  await expect(page.getByLabel('Describe a change')).toHaveValue('Rebuild this activity as a content topic.');
  await expect(page.getByRole('article', { name: 'Ready to download' })).toContainText('This version is a SCORM package. Send a request to rebuild it as a content topic.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('link', { name: /download content topic/i })).toBeVisible({ timeout: 15_000 });
});
