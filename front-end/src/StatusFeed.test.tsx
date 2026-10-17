import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { StatusFeed } from './StatusFeed';

it('follows the bottom, pauses on scroll up, and resumes on bottom, jump, or a new turn', () => {
  const lines = [{ seq: 1, text: 'Reading' }];
  const view = render(<StatusFeed lines={lines} turnId="t1" />);
  const feed = screen.getByRole('log', { name: 'Build progress' });
  Object.defineProperties(feed, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 500 },
  });
  view.rerender(<StatusFeed lines={[...lines, { seq: 2, text: 'Writing' }]} turnId="t1" />);
  expect(feed.scrollTop).toBe(500);
  fireEvent.scroll(feed, { target: { scrollTop: 150 } });
  expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeInTheDocument();
  view.rerender(<StatusFeed lines={[...lines, { seq: 3, text: 'Writing more' }]} turnId="t1" />);
  expect(feed.scrollTop).toBe(150);
  fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }));
  expect(feed.scrollTop).toBe(500);
  fireEvent.scroll(feed, { target: { scrollTop: 0 } });
  fireEvent.keyDown(feed, { key: 'End' });
  expect(feed.scrollTop).toBe(500);
  fireEvent.keyDown(feed, { key: 'Home' });
  expect(feed.scrollTop).toBe(0);
  fireEvent.scroll(feed, { target: { scrollTop: 400 } });
  expect(screen.queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument();
  fireEvent.scroll(feed, { target: { scrollTop: 0 } });
  view.rerender(<StatusFeed lines={lines} turnId="t2" />);
  expect(feed.scrollTop).toBe(500);
  expect(screen.queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument();
  expect(feed).toHaveAttribute('tabindex', '0');
  expect(feed).toHaveAttribute('aria-relevant', 'additions text');
});

it('retains existing line nodes and changes only the failed call text', () => {
  const view = render(<StatusFeed turnId="t1" lines={[{ seq: 1, text: 'Reading a' }]} />);
  const line = screen.getByText('Reading a');
  view.rerender(<StatusFeed turnId="t1" lines={[{ seq: 1, text: 'Reading a' }, { seq: 2, text: 'Writing b' }]} />);
  expect(screen.getByText('Reading a')).toBe(line);
  view.rerender(<StatusFeed turnId="t1" lines={[{ seq: 1, text: 'Failed: Reading a' }, { seq: 2, text: 'Writing b' }]} />);
  expect(screen.getByText('Failed: Reading a')).toBe(line);
});

it('uses category metadata for the summary and reveals every non-thinking step in details', () => {
  render(<StatusFeed turnId="t1" lines={[
    { seq: 1, text: 'Writing a guide', category: 'reading' },
    { seq: 2, text: 'Looking for source files', category: 'searching' },
    { seq: 3, text: 'Run smoke test of inline engine', category: 'other' },
    { seq: 4, text: 'Updating the activity', category: 'writing' },
    { seq: 5, text: 'Verifying the result', category: 'checking' },
    { seq: 6, text: 'Packaging the activity', category: 'building' },
    { seq: 7, text: 'Failed to read a file', category: 'reading', failed: true },
  ]} />);
  expect(screen.getAllByRole('listitem').map(line => line.textContent)).toEqual([
    'Run smoke test of inline engine', 'Updating the activity', 'Verifying the result', 'Packaging the activity', 'Failed to read a file',
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(7);
  expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');
});

it('summarizes consecutive file edits and keeps exact details available', () => {
  render(<StatusFeed turnId="t1" lines={[
    { seq: 1, text: 'Writing index.html', category: 'writing' },
    { seq: 2, text: 'Reading engine.js', category: 'reading' },
    { seq: 3, text: 'Writing engine.js', category: 'writing' },
    { seq: 4, text: 'Run smoke test of inline engine', category: 'other' },
    { seq: 5, text: 'Editing styles.css', category: 'writing' },
  ]} />);
  expect(screen.getAllByRole('listitem').map(line => line.textContent)).toEqual([
    'Updating the activity', 'Run smoke test of inline engine', 'Updating the activity',
  ]);
  expect(screen.queryByText('Writing index.html')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
  expect(screen.getByText('Writing index.html')).toBeVisible();
  expect(screen.getByText('Writing engine.js')).toBeVisible();
  expect(screen.getByText('Reading engine.js')).toBeVisible();
  expect(screen.getAllByRole('listitem')).toHaveLength(5);
});
