import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';

/** A stub turn takes about seven seconds from submit to `turn.completed`. */
const TURN_TIMEOUT = 15_000;

const QA_FINDING_EXPLANATIONS = [
  'lesson_status is set to "completed" during load; D2L will lock the learner out after one attempt.',
  'suspend_data can exceed 4000 characters; the tenant discards writes over 4096.',
];

async function submitRequest(page: Page, request: string) {
  await page.goto('/');
  await page.getByLabel('Project title').fill('Cell division practice');
  await page.getByLabel('What should students learn or do?').fill(request);
  await page.getByRole('button', { name: 'Send' }).click();
}

function statusLines(page: Page) {
  return page.getByRole('log', { name: 'Build progress' }).getByRole('listitem');
}

function buildCard(page: Page, heading: string) {
  return page.getByRole('article', { name: heading });
}

test('happy path: the status feed updates and the build is ready to download', async ({ page }) => {
  await submitRequest(page, 'Create a ten-question multiple-choice practice set on cell division.');

  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  await expect(statusLines(page).first()).toHaveText('Starting your build');
  await expect(statusLines(page).filter({ hasText: 'Building from the SCORM starter' })).toBeVisible();

  const card = buildCard(page, 'Ready to download');
  await expect(card).toBeVisible({ timeout: TURN_TIMEOUT });
  await expect(card).toContainText('BUILD 1');
  await expect(card).toContainText('The QA gate passed.');
  await expect(card.getByRole('link', { name: 'Download SCORM package' })).toBeVisible();
  await expect(page.getByText('Request complete', { exact: true })).toBeVisible({ timeout: TURN_TIMEOUT });
  await expect(statusLines(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
});

test('QA failure: each finding explains itself and no package is offered', async ({ page }) => {
  await submitRequest(page, '[qa-fail] Create a practice set on cell division.');

  const card = buildCard(page, 'QA needs attention');
  await expect(card).toBeVisible({ timeout: TURN_TIMEOUT });
  await expect(card).toContainText('The QA gate needs attention.');
  await expect(card.getByRole('listitem')).toContainText(QA_FINDING_EXPLANATIONS);

  await expect(page.getByText('Request complete', { exact: true })).toBeVisible({ timeout: TURN_TIMEOUT });
  await expect(page.getByRole('link', { name: 'Download SCORM package' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(0);
});

test('turn failure: a plain-language message appears without raw error details', async ({ page }) => {
  await submitRequest(page, '[turn-fail] Create a practice set on cell division.');

  await expect(page.getByLabel('Conversation history')).toContainText('The agent stopped before it finished.', {
    timeout: TURN_TIMEOUT,
  });
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();

  const panel = page.getByRole('region', { name: 'Build panel' });
  await expect(panel).not.toContainText('agent_error');
  await expect(panel).not.toContainText(/\b(Error|Exception):|\bat \S+ \(|\.[jt]sx?:\d+:\d+|\[object Object\]/);
  await expect(panel.getByRole('article')).toHaveCount(0);
});

test('reload mid-turn restores the feed without duplicate lines', async ({ page }) => {
  await submitRequest(page, 'Create a practice set on cell division.');
  await expect(statusLines(page).filter({ hasText: 'Building from the SCORM starter' })).toBeVisible();

  await page.reload();

  await expect(page.getByLabel('Request progress')).toBeVisible();
  await expect(statusLines(page).first()).toHaveText('Starting your build');
  await expect(buildCard(page, 'Ready to download')).toBeVisible({ timeout: TURN_TIMEOUT });
  await expect(page.getByText('Request complete', { exact: true })).toBeVisible({ timeout: TURN_TIMEOUT });
});

test('download: the SCORM package has imsmanifest.xml at the zip root', async ({ page }) => {
  await submitRequest(page, 'Create a practice set on cell division.');
  const link = buildCard(page, 'Ready to download').getByRole('link', { name: 'Download SCORM package' });
  await expect(link).toBeVisible({ timeout: TURN_TIMEOUT });

  const downloadEvent = page.waitForEvent('download');
  await link.click();
  const download = await downloadEvent;

  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const zip = await JSZip.loadAsync(await readFile(await download.path()));
  expect(Object.keys(zip.files)).toContain('imsmanifest.xml');
  expect(await zip.file('imsmanifest.xml')?.async('string')).toContain('<manifest');
});

test('build card: a build being checked shows a neutral state', async ({ page }) => {
  await submitRequest(page, '[qa-fail] Create a practice set on cell division.');

  await expect(page.getByRole('article', { name: 'Build is being checked' })).toMatchAriaSnapshot(
    `
    - article "Build is being checked":
      - /children: equal
      - paragraph: BUILD 1
      - heading "Build is being checked" [level=3]
    `,
    { timeout: TURN_TIMEOUT },
  );

  await expect(buildCard(page, 'QA needs attention')).toBeVisible({ timeout: TURN_TIMEOUT });
});
