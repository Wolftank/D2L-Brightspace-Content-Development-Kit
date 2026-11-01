import { expect, test, type Page } from '@playwright/test';

const FIRST_REQUEST = '[qa-fail] Create a practice quiz on cell division.';
const FOLLOW_UP = 'Fix the QA findings and keep the same questions.';
const FIRST_REPLY = 'I built the activity, but the QA gate found an issue.';
const SECOND_REPLY = 'I updated your activity with your requested changes.';
const TURN_TIMEOUT = 15_000;

test.describe.configure({ timeout: 60_000 });

const buildPanel = (page: Page) => page.getByRole('region', { name: 'Build' });
const buildCard = (page: Page) => buildPanel(page).getByRole('article');
const progressFeed = (page: Page) => buildPanel(page).getByRole('log', { name: 'Build progress' });
const threadMessages = (page: Page) => page.getByRole('group', { name: 'Conversation history' }).getByRole('article');
const sendButton = (page: Page) => page.getByRole('button', { name: 'Send', exact: true });
const projectId = (page: Page) => page.evaluate(() => new URLSearchParams(location.search).get('project')!);

/** Matches a thread message by its speaker and the start of its text. */
function threadEntry(speaker: 'You' | 'CDK', text: string): RegExp {
  return new RegExp(`^${speaker}\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

/** Starts a project whose first request fails QA and waits for that turn to finish. */
async function failFirstBuild(page: Page): Promise<void> {
  await page.goto('/?new=1');
  await page.getByLabel('Project title').fill('QA follow-up');
  await page.getByLabel('What should students learn or do?').fill(FIRST_REQUEST);
  await sendButton(page).click();
  await expect(buildCard(page).getByRole('heading', { name: 'QA needs attention' })).toBeVisible({ timeout: TURN_TIMEOUT });
  await expect(sendButton(page)).toBeEnabled({ timeout: TURN_TIMEOUT });
}

/** Replies in the thread to start the follow-up turn. */
async function sendFollowUp(page: Page): Promise<void> {
  await page.getByLabel('Describe a change').fill(FOLLOW_UP);
  await sendButton(page).click();
}

/** Waits for the follow-up turn to finish with a ready second build. */
async function expectSecondBuildReady(page: Page): Promise<void> {
  await expect(buildCard(page)).toContainText('Version 2', { timeout: TURN_TIMEOUT });
  await expect(buildCard(page).getByRole('heading', { name: 'Ready to download' })).toBeVisible();
  await expect(progressFeed(page).getByRole('listitem').last()).toHaveText('Build complete', { timeout: TURN_TIMEOUT });
  await expect(sendButton(page)).toBeEnabled();
}

test('a first request that fails QA shows the findings and no download', async ({ page }) => {
  await failFirstBuild(page);
  const card = buildCard(page);
  await expect(card).toContainText('Version 1');
  await expect(card.getByRole('listitem')).toHaveText([
    /^ERROR\s*lesson_status is set to "completed" during load/,
    /^WARNING\s*suspend_data can exceed 4000 characters/,
  ]);
  await expect(card.getByRole('button', { name: 'Ask for a fix' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download SCORM package' })).toHaveCount(0);
  await expect(progressFeed(page).getByRole('listitem')).toHaveText([
    'Starting your build',
    'Building from the SCORM starter',
    'QA gate reported 2 findings',
    'Build complete',
  ]);
});

test('a follow-up in the thread starts a new turn that produces a ready second build', async ({ page }) => {
  await failFirstBuild(page);
  const firstProject = await projectId(page);
  await sendFollowUp(page);

  await expect(page.getByRole('button', { name: 'Working…' })).toBeDisabled();
  await expect(buildPanel(page).getByRole('group', { name: 'Request progress' })).toBeVisible();
  await expect(progressFeed(page)).not.toContainText('QA gate reported');
  await expect(progressFeed(page)).toContainText('Running the QA gate', { timeout: TURN_TIMEOUT });

  await expectSecondBuildReady(page);
  await expect(progressFeed(page).getByRole('listitem')).toHaveText([
    'Starting your build',
    'Building from the SCORM starter',
    'Running the QA gate',
    'Build complete',
  ]);
  const card = buildCard(page);
  await expect(card.getByRole('listitem')).toHaveCount(0);
  await expect(card.getByRole('link', { name: 'Download SCORM package' })).toHaveAttribute('href', /\/api\/builds\/[^/]+\/download$/);
  await expect(page.getByLabel('Project title')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'QA follow-up' })).toBeVisible();
  expect(await projectId(page)).toBe(firstProject);
});

test('the thread shows both requests and both replies in order', async ({ page }) => {
  await failFirstBuild(page);
  await expect(threadMessages(page)).toHaveText([threadEntry('You', FIRST_REQUEST), threadEntry('CDK', FIRST_REPLY)]);
  await sendFollowUp(page);
  await expectSecondBuildReady(page);
  await expect(threadMessages(page)).toHaveText([
    threadEntry('You', FIRST_REQUEST),
    threadEntry('CDK', FIRST_REPLY),
    threadEntry('You', FOLLOW_UP),
    threadEntry('CDK', SECOND_REPLY),
  ]);
});

test('reloading after the follow-up restores the thread and latest build without duplicates', async ({ page }) => {
  await failFirstBuild(page);
  await sendFollowUp(page);
  await expectSecondBuildReady(page);

  await page.reload();
  await expectSecondBuildReady(page);
  await expect(threadMessages(page)).toHaveText([
    threadEntry('You', FIRST_REQUEST),
    threadEntry('CDK', FIRST_REPLY),
    threadEntry('You', FOLLOW_UP),
    threadEntry('CDK', SECOND_REPLY),
  ]);
  await expect(buildCard(page)).toHaveCount(1);
  await expect(buildCard(page).getByRole('heading', { name: 'QA needs attention' })).toHaveCount(0);
  await expect(buildCard(page).getByRole('link', { name: 'Download SCORM package' })).toBeVisible();
});