import { expect, test } from '@playwright/test';

test('configurator page loads', async ({ page }) => {
    await page.goto('/?new=1');

    await expect(page.getByRole('heading', {name: 'Create an activity' })).toBeVisible();
    await expect(page.getByLabel('Project title')).toBeEditable();
    await expect(page.getByRole('button', {name: 'Send', exact: true })).toBeEnabled();
});