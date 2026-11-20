import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('only the latest build shows optional design suggestions', async ({ page }) => {
  await page.goto('/?new=1');
  await page.getByLabel('Project title').fill('Cell division');
  await page.getByLabel('What should students learn or do?').fill('Create an activity on cell division with design suggestions.');
  await page.getByRole('button', { name: 'Send' }).click();

  const build = page.getByRole('article', { name: 'Ready to download' });
  const section = build.getByRole('region', { name: 'Suggestions' });
  await expect(section.getByRole('listitem')).toHaveCount(2, { timeout: 15_000 });
  await expect(section).toContainText('TILT · Criteria');
  await expect(section).toContainText('Students can compare their work');
  await expect(section).toContainText('UDL · Action & Expression');
  await expect(section).toContainText('Multiple response formats');
  await expect(section).toContainText('optional and do not affect the download');
  await expect(build.getByRole('link', { name: 'Download SCORM package' })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('.build-suggestions').analyze()).violations).toEqual([]);

  await page.getByLabel('Describe a change').fill('Add a review question.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(build).toContainText('Version 2', { timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Suggestions' })).toHaveCount(0);
});
