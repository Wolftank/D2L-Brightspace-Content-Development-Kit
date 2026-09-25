import { expect, test } from '@playwright/test';

test('configurator page loads', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', {name: 'Describe what you want to build.' })).toBeVisible();
    await expect(page.getByLabel('Project title')).toBeEditable();
    await expect(page.getByRole('button', {name: 'Build activity' })).toBeEnabled();
});