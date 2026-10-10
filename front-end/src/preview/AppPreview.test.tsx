import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PreviewPanel } from './PreviewPanel';

it('shows a labelled placeholder before the first ready build', () => {
  render(<PreviewPanel build={null} />);
  expect(screen.getByRole('region', { name: 'Preview' })).toBeVisible();
  expect(screen.getByText('Your activity will appear here when the first build is ready.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Restart preview' })).not.toBeInTheDocument();
});
