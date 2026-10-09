import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const failedFirst of [false, true]) {
  test(`conversation ${failedFirst ? 'recovers from QA failure' : 'refines a ready build'} and restores on reload`, async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Project title').fill('Cell division practice');
    await page.getByLabel('What should students learn or do?').fill(`${failedFirst ? '[qa-fail] ' : ''}Create a practice quiz.`);
    await page.getByRole('button', { name: 'Send' }).click();
    const draft = page.getByLabel('Describe a change');
    await expect(draft).toBeFocused();
    await draft.fill('Make the answer buttons larger.');
    await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
    await expect(page.getByRole('heading', { name: failedFirst ? 'QA needs attention' : 'Ready to download' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
    await expect(draft).toHaveValue('Make the answer buttons larger.');
    if (failedFirst) await expect(page.getByRole('link', { name: 'Download SCORM package' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('BUILD 2', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Ready to download' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
    const thread = page.getByLabel('Conversation history');
    await expect(thread.getByRole('article')).toHaveCount(4);
    await expect(thread.getByRole('article').nth(0)).toContainText('Create a practice quiz.');
    await expect(thread.getByRole('article').nth(2)).toContainText('Make the answer buttons larger.');
    await expect(page.getByTitle('Interactive preview of build 2')).toBeVisible();
    const activity = page.frameLocator('iframe[title="Interactive preview of build 2"]').frameLocator('#activity');
    await activity.getByRole('button', { name: 'Right answer', exact: true }).click();
    await expect(activity.locator('#score')).toHaveText('1 of 3 answered');
    await page.getByRole('button', { name: 'Restart preview' }).click();
    await expect(activity.locator('#score')).toHaveText('0 of 3 answered');
    await page.reload();
    await expect(thread.getByRole('article')).toHaveCount(4);
    await expect(page.getByText('BUILD 2', { exact: true })).toBeVisible();
    await expect(page.getByTitle('Interactive preview of build 2')).toBeVisible();
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('active-project')!).id as string);
    await page.evaluate(() => sessionStorage.clear());
    await page.goto('/?project=' + stored);
    await expect(thread.getByRole('article')).toHaveCount(4);
    await expect(page.getByText('BUILD 2', { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    const chat = await page.getByRole('region', { name: 'Conversation' }).boundingBox();
    const build = await page.getByRole('region', { name: 'Build panel' }).boundingBox();
    const preview = await page.getByRole('region', { name: 'Preview · Version 2' }).boundingBox();
    expect(build!.y).toBeGreaterThan(chat!.y + chat!.height);
    expect(preview!.y).toBeGreaterThan(build!.y + build!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('a failed later build retains the last ready preview', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Project title').fill('Keep ready preview');
  await page.getByLabel('What should students learn or do?').fill('Create a quiz');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled({ timeout: 15000 });
  await expect(page.getByTitle('Interactive preview of build 1')).toBeVisible();
  await page.getByLabel('Describe a change').fill('[qa-fail] Change the activity');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('BUILD 2', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('heading', { name: 'QA needs attention' })).toBeVisible();
  await expect(page.getByTitle('Interactive preview of build 1')).toBeVisible();
});
