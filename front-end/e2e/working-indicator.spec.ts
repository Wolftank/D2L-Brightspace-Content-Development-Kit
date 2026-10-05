import { expect, test } from '@playwright/test';

test('silent turn keeps its step and real elapsed time after reload and replay in a new tab', async ({ page, context }) => {
  test.setTimeout(45_000);
  await page.goto('/');
  await page.getByLabel('Project title').fill('Long silent turn');
  await page.getByLabel('What should students learn or do?').fill('[long-step] Create a quiz');
  await page.getByRole('button', { name: 'Build activity' }).click();
  const indicator = page.getByLabel('Request progress');
  await expect(indicator).toContainText('Building from the SCORM starter');
  const project = await page.evaluate(() => sessionStorage.getItem('active-project'));
  await page.waitForTimeout(3100);
  const elapsed = await page.getByLabel('Elapsed time').textContent();
  await page.reload();
  await expect(indicator).toContainText('Building from the SCORM starter');
  const seconds = (value: string | null) => value!.split(':').reduce((minutes, part) => minutes * 60 + Number(part), 0);
  expect(seconds(await page.getByLabel('Elapsed time').textContent())).toBeGreaterThanOrEqual(seconds(elapsed));
  const tab = await context.newPage();
  await tab.goto('/');
  await tab.evaluate((saved) => sessionStorage.setItem('active-project', saved!), project);
  await tab.reload();
  await expect(tab.getByLabel('Request progress')).toContainText('Building from the SCORM starter');
  expect(Math.abs(seconds(await tab.getByLabel('Elapsed time').textContent()) - seconds(await page.getByLabel('Elapsed time').textContent()))).toBeLessThanOrEqual(2);
  await expect(indicator).toHaveCount(0, { timeout: 35_000 });
});
