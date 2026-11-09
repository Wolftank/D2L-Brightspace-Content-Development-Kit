import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('creates, previews, and downloads a Content Topic with accessible role controls and D2L instructions', async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto('/?new=1');

  await page.getByLabel('Project title').fill('Content Topic test');

  await page.getByRole('radio', {
    name: 'Content topic',
  }).check();

  await expect(
    page.getByRole('radio', {
      name: 'Content topic',
    }),
  ).toBeChecked();

  await expect(
    page.getByRole('radio', {
      name: 'SCORM package',
    }),
  ).not.toBeChecked();

  await page
    .getByLabel('What should students learn or do?')
    .fill('Create a content topic about cell division.');

  await page
    .getByRole('button', {
      name: 'Send',
      exact: true,
    })
    .click();

  await expect(
    page.getByText('Output format:'),
  ).toBeVisible();

  await expect(
    page.getByText('Content topic', {
      exact: true,
    }),
  ).toBeVisible();

  const preview = page.getByRole('region', {
    name: /Preview · Version 1/,
  });

  await expect(preview).toBeVisible({
    timeout: 15_000,
  });

  const student = preview.getByRole('radio', {
    name: 'Student',
  });

  const instructor = preview.getByRole('radio', {
    name: 'Instructor',
  });

  await expect(student).toBeChecked();
  await expect(instructor).not.toBeChecked();

  const frame = preview.locator('iframe');

  await expect(frame).toHaveAttribute(
    'src',
    /avenue=topic/,
  );

  await expect(frame).toHaveAttribute(
    'src',
    /role=Student/,
  );

  await instructor.check();

  await expect(instructor).toBeChecked();
  await expect(student).not.toBeChecked();

  await expect(frame).toHaveAttribute(
    'src',
    /role=Instructor/,
  );

  const download = page.getByRole('link', {
    name: 'Download Content Topic package',
  });

  await expect(download).toBeVisible();

  const packageDownload = page.waitForEvent('download');

  await download.click();

  expect(
    (await packageDownload).suggestedFilename(),
  ).toMatch(/\.zip$/);

  const guide = page.getByRole('dialog', {
    name: 'Add to D2L',
  });

  await expect(guide).toBeVisible();

  await expect(
    guide.getByText(
      /Content Topic package from build 1/,
    ),
  ).toBeVisible();

  await expect(
    guide.getByText(/Add Existing/),
  ).toBeVisible();

  await expect(
    guide.getByText(/SCORM ZIP/),
  ).not.toBeVisible();

  expect(
    (
      await new AxeBuilder({ page })
        .withTags([
          'wcag2a',
          'wcag2aa',
          'wcag21a',
          'wcag21aa',
          'wcag22aa',
        ])
        .analyze()
    ).violations,
  ).toEqual([]);

  await guide
    .getByRole('button', {
      name: 'Close instructions',
    })
    .click();
});

test('SCORM remains the default output format', async ({ page }) => {
  await page.goto('/?new=1');

  await expect(
    page.getByRole('radio', {
      name: 'SCORM package',
    }),
  ).toBeChecked();

  await expect(
    page.getByRole('radio', {
      name: 'Content topic',
    }),
  ).not.toBeChecked();
});