import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function send(page: Page, request: string) {
  await page.goto('/?new=1');
  await page.getByLabel('Project title').fill('Stop request test');
  await page.getByLabel('What should students learn or do?').fill(request);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

test('stops a running request and continues the same project', async ({ page }) => {
  await send(page, '[long-step] Create an activity.');
  await expect(page.getByLabel('Request progress')).toBeVisible();
  const draft = page.getByLabel('Describe a change');
  await draft.fill('Make a shorter activity instead.');
  const stop = page.getByRole('button', { name: 'Stop request' });
  await stop.focus();
  await page.keyboard.press('Enter');
  const history = page.getByLabel('Conversation history');
  await expect(history.getByText('Request stopped.', { exact: true })).toBeVisible();
  await expect(page.getByText('Request stopped. You can send a follow-up.')).toHaveAttribute('role', 'status');
  await expect(page.getByLabel('Request progress')).toHaveCount(0);
  await expect(page.getByText('No build yet.')).toBeVisible();
  await expect(stop).toHaveCount(0);
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue('Make a shorter activity instead.');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.reload();
  await expect(history.getByText('Request stopped.', { exact: true })).toBeVisible();
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(history.getByText('Request stopped.', { exact: true })).toBeVisible();
  await draft.fill('Make a shorter activity instead.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(history).toContainText('Make a shorter activity instead.');
  await expect(page.getByRole('heading', { name: 'Ready to download' })).toBeVisible({ timeout: 15_000 });
  await expect(history.getByText('Request stopped.', { exact: true })).toHaveCount(1);
});

test('the stub cancelled scenario shows a stopped request and unlocks the composer', async ({ page }) => {
  await send(page, '[cancelled] Create an activity.');
  await expect(page.getByLabel('Conversation history').getByText('Request stopped.', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Stop request' })).toHaveCount(0);
});
