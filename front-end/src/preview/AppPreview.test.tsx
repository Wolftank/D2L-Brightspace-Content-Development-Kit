import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PreviewPanel } from './PreviewPanel';

it('hides the preview until a ready build exists', () => {
  render(<PreviewPanel build={null} />);
  expect(screen.queryByRole('region', { name: 'Preview' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Restart preview' })).not.toBeInTheDocument();
});
