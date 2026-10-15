import { expect, test } from '@playwright/test';

for (const step of ['send_again', 'try_smaller_request', 'sign_in_to_agent', 'try_again_later', 'wait_for_current_request', 'start_new_project']) {
  test(`offers the ${step} recovery step`, async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Project title').fill('Error recovery');
    const request = `[${step}] Create a quiz`;
    await page.getByLabel('What should students learn or do?').fill(request);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const chat = page.getByLabel('Conversation history');
    await expect(chat.getByRole('alert')).toContainText('The agent stopped', { timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    if (step === 'send_again') {
      await chat.getByRole('button', { name: 'Send again' }).click();
      await expect(chat.getByText(request, { exact: true })).toHaveCount(2);
    } else if (step === 'try_smaller_request') {
      await chat.getByRole('button', { name: 'Try a smaller request' }).click();
      await expect(page.getByLabel('Describe a change')).toHaveValue(request);
      await expect(page.getByLabel('Describe a change')).toBeFocused();
    } else if (step === 'sign_in_to_agent') {
      const popup = page.waitForEvent('popup');
      await chat.getByRole('link', { name: 'Sign in to the agent' }).click();
      await expect((await popup).getByRole('heading', { name: 'Agent sign-in' })).toBeVisible();
    } else if (step === 'start_new_project') {
      await chat.getByRole('button', { name: 'Start a new project' }).click();
      await expect(page.getByLabel('Project title')).toBeEditable();
    } else await expect(chat.getByText(step === 'try_again_later' ? 'Try again later.' : 'Wait for the current request to finish.')).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/SQLITE_|agent_error|Error:|\bat \S+ \(/);
  });
}

test('retrying a lost stream keeps the draft and recovers progress', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await page.getByLabel('Project title').fill('Reconnect');
  await page.getByLabel('What should students learn or do?').fill('[drop-lost] Create a quiz');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByLabel('Describe a change').fill('Keep this draft');
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible({ timeout: 40000 });
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ready to download' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByLabel('Describe a change')).toHaveValue('Keep this draft');
});
