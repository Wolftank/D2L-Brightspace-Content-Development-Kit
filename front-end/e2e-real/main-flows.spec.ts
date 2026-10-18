import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';

/** A scripted turn and its build take a few seconds on the real back end. */
const TURN_TIMEOUT = 20_000;

async function submitRequest(page: Page, request: string) {
  await page.goto('/');
  await page.getByLabel('Project title').fill('Workplace safety practice');
  await page.getByLabel('What should students learn or do?').fill(request);
  await page.getByRole('button', { name: 'Send' }).click();
}

function buildCard(page: Page, heading: string) {
  return page.getByRole('article', { name: heading });
}

test('a request becomes a build that passes the QA gate and downloads with its manifest at the zip root', async ({ page }) => {
  await submitRequest(page, 'Create a five-question practice set on workplace safety.');

  const card = buildCard(page, 'Ready to download');
  await expect(card).toBeVisible({ timeout: TURN_TIMEOUT });
  await expect(card).toContainText('BUILD 1');
  await expect(page.getByLabel('Conversation history')).toContainText('practice set on workplace safety');

  const downloadEvent = page.waitForEvent('download');
  await card.getByRole('link', { name: 'Download SCORM package' }).click();
  const zip = await JSZip.loadAsync(await readFile(await (await downloadEvent).path()));
  expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['imsmanifest.xml', 'index.html']));
  expect(await zip.file('index.html')?.async('string')).toContain('chemical spill');
});

test('a build the QA gate rejects shows its findings and offers no package', async ({ page }) => {
  await submitRequest(page, '[qa-fail] Create a practice set on workplace safety.');

  const card = buildCard(page, 'QA needs attention');
  await expect(card).toBeVisible({ timeout: TURN_TIMEOUT });
  await expect(card.getByRole('listitem').first()).toContainText('completed');
  await expect(page.getByRole('link', { name: 'Download SCORM package' })).toHaveCount(0);
});

test('a failed turn shows its plain message and makes no build', async ({ page }) => {
  await submitRequest(page, '[turn-fail] Create a practice set on workplace safety.');

  await expect(page.getByLabel('Conversation history')).toContainText('The agent stopped with an error before it finished.', {
    timeout: TURN_TIMEOUT,
  });
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Build panel' }).getByRole('article')).toHaveCount(0);
});

test('a follow-up request makes version 2', async ({ page }) => {
  await submitRequest(page, 'Create a five-question practice set on workplace safety.');
  await expect(buildCard(page, 'Ready to download')).toContainText('BUILD 1', { timeout: TURN_TIMEOUT });
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled({ timeout: TURN_TIMEOUT });

  await page.getByLabel('Describe a change').fill('[follow-up] Add two more questions.');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(buildCard(page, 'Ready to download')).toContainText('BUILD 2', { timeout: TURN_TIMEOUT });
});
