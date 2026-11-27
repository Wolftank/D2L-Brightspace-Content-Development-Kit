import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { QaFinding } from '@cdk/contract';
import { QaFindings } from './QaFindings';

const missingAlt: QaFinding = {
  rule: 'a11y/alt',
  severity: 'error',
  file: 'index.html',
  line: 12,
  message: 'Image has no alt text.',
  because: 'WCAG 2.2 SC 1.1.1 (Non-text Content).',
  explanation: "Students who use a screen reader won't know what an image shows.",
};
const tallRoot: QaFinding = {
  rule: 'scorm/root-height',
  severity: 'warn',
  file: 'index.html',
  line: 4,
  message: 'Fixed height 1100px exceeds ~600px.',
  because: 'The embedded player will not scroll a tall child.',
  explanation: 'This activity is taller than the space D2L gives it.',
};

it('shows each finding as its severity in plain words and its explanation, a fix needed first', () => {
  render(<QaFindings findings={[tallRoot, missingAlt]} />);

  expect(screen.getAllByRole('listitem').map(finding => finding.textContent)).toEqual([
    expect.stringMatching(/^Needs a fixStudents who use a screen reader won't know what an image shows\./),
    expect.stringMatching(/^Worth a lookThis activity is taller than the space D2L gives it\./),
  ]);
});

it('keeps the technical text behind Details until it is opened', () => {
  render(<QaFindings findings={[missingAlt]} />);
  const finding = screen.getByRole('listitem');
  const message = within(finding).getByText(/Image has no alt text\./);
  const because = within(finding).getByText('WCAG 2.2 SC 1.1.1 (Non-text Content).');
  expect(message).not.toBeVisible();
  expect(because).not.toBeVisible();

  fireEvent.click(within(finding).getByText('Details'));
  expect(message).toBeVisible();
  expect(message).toHaveTextContent('index.html:12 Image has no alt text.');
  expect(because).toBeVisible();

  fireEvent.click(within(finding).getByText('Details'));
  expect(message).not.toBeVisible();
});

it('shows a rule broken in several places once, with each place under Details', () => {
  render(<QaFindings findings={[missingAlt, tallRoot, { ...missingAlt, line: 30 }]} />);

  const [alt, height] = screen.getAllByRole('listitem');
  expect(alt).toHaveTextContent('Needs a fix2 places');
  expect(within(alt!).getByText(/index\.html:12/)).toBeInTheDocument();
  expect(within(alt!).getByText(/index\.html:30/)).toBeInTheDocument();
  expect(within(alt!).getAllByText('WCAG 2.2 SC 1.1.1 (Non-text Content).')).toHaveLength(1);
  expect(height).not.toHaveTextContent('places');
});
