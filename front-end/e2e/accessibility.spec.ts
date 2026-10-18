import { expect, test, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Q9 (#54): WCAG A and AA baseline for the configurator page (NFR-08). */

/** A stub turn takes about seven seconds from submit to `turn.completed`. */
const TURN_TIMEOUT = 15_000;

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** These impacts fail the spec. Moderate and minor violations are logged and attached to the report. */
const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

/**
 * Rules turned off until their bug is fixed. Every entry needs a comment linking its issue.
 * Remove the entry when that issue closes. Example:
 *   'color-contrast', // https://github.com/Wolftank/D2L-Brightspace-Content-Development-Kit/issues/NNN (this isnt real just an example)
 */
const EXCLUDED_RULES: string[] = [];

type Violation = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number];

function summarize(violation: Violation): string {
  const targets = violation.nodes.map((node) => node.target.join(' ')).join(', ');
  return `${violation.impact ?? 'unknown'} ${violation.id}: ${violation.help} [${targets}] ${violation.helpUrl}`;
}

async function scan(page: Page, testInfo: TestInfo, state: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).disableRules(EXCLUDED_RULES).analyze();
  const blocking = results.violations.filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ''));
  const logged = results.violations.filter((violation) => !blocking.includes(violation));
  const summary = `${blocking.length} serious/critical, ${logged.length} moderate/minor, ${results.incomplete.length} need manual review, ${results.passes.length} rules passed`;

  testInfo.annotations.push({ type: `axe: ${state}`, description: summary });
  await testInfo.attach(`axe-${state.toLowerCase().replace(/\s+/g, '-')}.json`, {
    body: JSON.stringify({ violations: results.violations, incomplete: results.incomplete }, null, 2),
    contentType: 'application/json',
  });
  console.log(`[axe] ${state} (${testInfo.project.name}): ${summary}`);
  for (const violation of logged) console.log(`[axe] ${state}: ${summarize(violation)}`);

  expect(blocking.map(summarize), `serious or critical WCAG violations in the ${state} state`).toEqual([]);
}

async function startRequest(page: Page, request: string) {
  await page.goto('/');
  await page.getByLabel('Project title').fill('Accessibility baseline');
  await page.getByLabel('What should students learn or do?').fill(request);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

test.describe('accessibility baseline', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('empty form', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Create an activity' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    await scan(page, testInfo, 'empty form');
  });

  test('turn running', async ({ page }, testInfo) => {
    // [long-step] holds the turn for about 20 seconds, so the scan sees the running state
    await startRequest(page, '[long-step] Create a practice quiz.');
    const progress = page.getByRole('region', { name: 'Build' }).getByLabel('Request progress');
    await expect(progress).toContainText('Building from the SCORM starter');
    await expect(page.getByRole('log', { name: 'Build progress' })).toBeVisible();
    await scan(page, testInfo, 'turn running');
    // Confirms the turn was still running when the scan finished
    await expect(progress).toBeVisible();
  });

  test('build ready', async ({ page }, testInfo) => {
    await startRequest(page, 'Create a practice quiz.');
    const panel = page.getByRole('region', { name: 'Build' });
    await expect(panel.getByRole('heading', { name: 'Ready to download' })).toBeVisible({ timeout: TURN_TIMEOUT });
    await expect(panel.getByText('Request complete', { exact: true })).toBeVisible({ timeout: TURN_TIMEOUT });
    await expect(page.getByRole('region', { name: 'Preview · Version 1' }).getByRole('status')).toHaveText('Preview ready.', { timeout: TURN_TIMEOUT });
    await scan(page, testInfo, 'build ready');
  });

  test('QA failed', async ({ page }, testInfo) => {
    await startRequest(page, '[qa-fail] Create a practice quiz.');
    const card = page.getByRole('article', { name: 'QA needs attention' });
    await expect(card).toBeVisible({ timeout: TURN_TIMEOUT });
    await expect(card.getByRole('listitem')).toHaveCount(2);
    await expect(page.getByText('Request complete', { exact: true })).toBeVisible({ timeout: TURN_TIMEOUT });
    await scan(page, testInfo, 'QA failed');
  });
});