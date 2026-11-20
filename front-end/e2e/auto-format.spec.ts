import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('CDK picks a content topic and updates the open project', async ({ page }) => {
  await page.goto('/?new=1');
  const formats = page.getByRole('group', { name: 'Format' });
  const auto = formats.getByRole('radio', { name: 'Let CDK choose' });
  await expect(auto).toBeChecked();
  await expect(auto).toHaveAccessibleDescription('CDK picks the format from your request.');
  await expect(formats.getByRole('radio')).toHaveCount(3);
  expect((await new AxeBuilder({ page }).include('.format-options').analyze()).violations).toEqual([]);

  await page.getByLabel('Project title').fill('Cell division activity');
  await page.getByLabel('What should students learn or do?').fill('Create a cell division lesson with separate student and instructor views.');
  const creation = page.waitForResponse(response => new URL(response.url()).pathname === '/api/projects' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send' }).click();
  const created = await creation;
  expect(created.request().postDataJSON()).toEqual({ title: 'Cell division activity' });
  expect((await created.json()).project.avenue).toBeNull();
  await expect(page.locator('.workspace-eyebrow')).toHaveText('Project');
  await expect(page.locator('.workspace-eyebrow')).toHaveText('Project · Content topic', { timeout: 15_000 });
  await expect(page.getByRole('link', { name: /download content topic/i })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Instructor' })).toBeVisible();

  await page.getByRole('button', { name: 'Add to D2L instructions' }).click();
  await expect(page.getByRole('dialog', { name: 'Add to D2L' })).toContainText(/content topic/i);
});
