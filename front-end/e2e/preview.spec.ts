import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

async function buildActivity(page: Page) {
  await page.goto('/');
  await page.getByLabel('Project title').fill('Preview fixture');
  await page.getByLabel('What should students learn or do?').fill('Create a sample activity.');
  await page.getByRole('button', { name: 'Build activity' }).click();
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeVisible({ timeout: 15_000 });
}

test('saved starter runs in Student mode, restarts, keeps its version and returns focus', async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1024, height: 900 });
  await buildActivity(page);
  const downloadUrl = await page.getByRole('link', { name: 'Download SCORM package' }).getAttribute('href');
  const buildId = downloadUrl!.split('/')[3]!;
  const before = await (await request.get(`/api/builds/${buildId}`)).json();
  const packageBefore = await (await request.get(downloadUrl!)).body();
  expect(packageBefore).toEqual(readFileSync(new URL('../stub/fixtures/preview.zip', import.meta.url)));
  const savedPreview = `http://127.0.0.1:3002/api/builds/${buildId}/preview/`;
  expect(await (await request.get(`${savedPreview}index.html`)).body()).toEqual(readFileSync(new URL('../stub/fixtures/preview/index.html', import.meta.url)));
  expect((await request.get(`${savedPreview}%2e%2e%2fserver.ts`)).status()).toBe(404);
  expect((await request.get('http://127.0.0.1:3002/api/builds/missing/preview/index.html')).status()).toBe(404);
  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  await preview.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Preview — Build 1' })).toBeFocused();
  await expect(page.getByRole('status')).toHaveText('Preview ready.');
  const wrapper = page.frameLocator('iframe[title="Interactive preview of build 1"]');
  const activity = wrapper.frameLocator('#activity');
  await expect(activity.getByRole('heading', { name: 'Sample SCORM activity' })).toBeVisible();
  await expect(activity.locator('#banner')).toBeHidden();
  await expect(activity.locator('#root')).toHaveCSS('border-top-width', '4px');
  await activity.getByRole('group', { name: 'Replace this question.', exact: true }).getByRole('button', { name: 'Right answer', exact: true }).click();
  await activity.getByRole('group', { name: 'And this one.', exact: true }).getByRole('button', { name: 'Right', exact: true }).click();
  await activity.getByRole('group', { name: 'And this one too.', exact: true }).getByRole('button', { name: 'Right', exact: true }).click();
  await activity.getByRole('button', { name: 'Submit', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(activity.locator('#score')).toHaveText('Submitted. Score: 3 of 3');
  const player = page.frames().find((frame) => frame.url().includes('/preview/player.html'))!;
  expect(await player.evaluate(() => {
    const api = (window as unknown as { API: { LMSGetValue: (key: string) => string } }).API;
    return [api.LMSGetValue('cmi.core.credit'), api.LMSGetValue('cmi.core.score.raw')];
  })).toEqual(['credit', '100']);
  expect(await player.evaluate(() => {
    try { void window.parent.document.body; return false; } catch { return true; }
  })).toBe(true);
  await page.getByRole('button', { name: 'Restart preview' }).focus();
  await page.keyboard.press('Enter');
  await expect(activity.locator('#score')).toHaveText('0 of 3 answered');
  await expect(activity.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Build activity', exact: true })).toBeEnabled();
  const selectedUrl = await page.getByTitle('Interactive preview of build 1').getAttribute('src');
  await page.getByLabel('Project title').fill('Another project');
  await page.getByRole('button', { name: 'Build activity', exact: true }).click();
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('link', { name: 'Download SCORM package' })).not.toHaveAttribute('href', downloadUrl!);
  await expect(page.getByRole('heading', { name: 'Preview — Build 1' })).toBeVisible();
  await expect(page.getByTitle('Interactive preview of build 1')).toHaveAttribute('src', selectedUrl!);
  await preview.click();
  await expect(page.getByTitle('Interactive preview of build 1')).not.toHaveAttribute('src', selectedUrl!);
  await expect(page.getByTitle('Interactive preview of build 1')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('preview-1024.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(preview).toBeFocused();
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(await (await request.get(`/api/builds/${buildId}`)).json()).toEqual(before);
  expect(await (await request.get(downloadUrl!)).body()).toEqual(packageBefore);
});

test('unavailable builds and launch failures offer retry', async ({ page }) => {
  await buildActivity(page);
  const launchPattern = '**:3002/api/builds/*/preview/index.html';
  await page.route(launchPattern, (route) => route.fulfill({ status: 404 }));
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('saved build is unavailable');
  await page.unroute(launchPattern);
  await page.route('**:3002/preview/tenant-profile.json', (route) => route.fulfill({ status: 500 }));
  await page.getByRole('button', { name: 'Retry preview' }).click();
  await expect(page.getByRole('alert')).toContainText('activity could not be opened');
  await page.unroute('**:3002/preview/tenant-profile.json');
  await page.getByRole('button', { name: 'Retry preview' }).click();
  await expect(page.getByRole('status')).toHaveText('Preview ready.');
});
