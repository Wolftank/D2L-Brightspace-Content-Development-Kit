import { expect, test, type Page } from '@playwright/test';

/** A scripted turn and its build take a few seconds on the real back end. */
const TURN_TIMEOUT = 20_000;

async function submitRequest(page: Page, request: string) {
  await page.goto('/?new=1');
  await page.getByLabel('Project title').fill('Workplace safety recovery');
  await page.getByLabel('What should students learn or do?').fill(request);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

const history = (page: Page) => page.getByRole('group', { name: 'Conversation history' });
const sendButton = (page: Page) => page.getByRole('button', { name: 'Send', exact: true });
const buildCards = (page: Page) => page.getByRole('region', { name: 'Build', exact: true }).getByRole('article');
const buildCard = (page: Page, heading: string) => page.getByRole('article', { name: heading });

test('each QA finding on the build card shows its explanation', async ({ page }) => {
  await submitRequest(page, '[qa-fail] Create a practice set on workplace safety.');

  const card = buildCard(page, 'QA needs attention');
  await expect(card).toBeVisible({ timeout: TURN_TIMEOUT });
  const findings = card.getByRole('listitem');
  await expect(findings.first()).toBeVisible();
  for (const finding of await findings.all()) {
    await expect(finding.getByRole('paragraph')).not.toBeEmpty();
  }
  await expect(findings.filter({ hasText: 'Writes "completed" at top level' }).getByRole('paragraph'))
    .toHaveText(/^Measured: once an activity reports lesson_status "completed", D2L serves later launches in review mode/);
});

test('a signed-out agent fails the turn with a sign-in link and makes no build', async ({ page }) => {
  await submitRequest(page, '[signed-out] Create a practice set on workplace safety.');

  await expect(history(page).getByRole('alert')).toHaveText("The agent isn't signed in, or its account can't be used.", { timeout: TURN_TIMEOUT });
  await expect(history(page).getByRole('link', { name: 'Sign in to the agent' })).toHaveAttribute('href', '/api/agent/sign-in');
  await expect(sendButton(page)).toBeEnabled();
  await expect(buildCards(page)).toHaveCount(0);
});

test('a busy agent fails the turn with its message and next step and makes no build', async ({ page }) => {
  await submitRequest(page, '[busy] Create a practice set on workplace safety.');

  await expect(history(page).getByRole('alert')).toHaveText("The agent's account is busy or has reached its usage limit.", { timeout: TURN_TIMEOUT });
  await expect(history(page).getByText('Try again later.', { exact: true })).toBeVisible();
  await expect(sendButton(page)).toBeEnabled();
  await expect(buildCards(page)).toHaveCount(0);
});

test('a turn the agent cancels shows the request stopped and makes no build', async ({ page }) => {
  await submitRequest(page, '[cancelled] Create a practice set on workplace safety.');

  await expect(history(page).getByText('Request stopped.', { exact: true })).toBeVisible({ timeout: TURN_TIMEOUT });
  await expect(sendButton(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Stop request' })).toHaveCount(0);
  await expect(page.getByText('No build yet.', { exact: true })).toBeVisible();
  await expect(buildCards(page)).toHaveCount(0);
});

test('the working indicator keeps its step and elapsed time through a silent pause, then the turn finishes', async ({ page }) => {
  test.setTimeout(60_000);
  await submitRequest(page, '[long-step] Create a practice set on workplace safety.');

  const indicator = page.getByRole('group', { name: 'Request progress' });
  await expect(indicator).toHaveText(/^Building from the SCORM starter\s*0:0[3-9]$/, { timeout: 10_000 });
  await expect(indicator).toHaveText(/^Building from the SCORM starter\s*0:1\d$/, { timeout: 15_000 });

  await expect(buildCard(page, 'Ready to download')).toContainText('Version 1', { timeout: 30_000 });
  await expect(indicator).toHaveCount(0);
});

test('a QA failure followed by a reply in the thread ends with a ready version 2', async ({ page }) => {
  await submitRequest(page, '[qa-fail] Create a practice set on workplace safety.');
  const failed = buildCard(page, 'QA needs attention');
  await expect(failed).toContainText('Version 1', { timeout: TURN_TIMEOUT });
  await expect(sendButton(page)).toBeEnabled({ timeout: TURN_TIMEOUT });

  await failed.getByRole('button', { name: 'Ask for a fix' }).click();
  await expect(page.getByLabel('Describe a change')).toHaveValue('Please fix the problems reported by the QA check in build 1.');
  await sendButton(page).click();

  const ready = buildCard(page, 'Ready to download');
  await expect(ready).toContainText('Version 2', { timeout: TURN_TIMEOUT });
  await expect(ready.getByRole('link', { name: 'Download SCORM package' })).toBeVisible();
  await expect(buildCards(page)).toHaveCount(1);
  await expect(history(page)).toContainText('Please fix the problems reported by the QA check in build 1.');
});