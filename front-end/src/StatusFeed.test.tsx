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
  view.rerender(<StatusFeed lines={[...lines, { seq: 3, text: 'Thinking' }]} turnId="t1" />);
  expect(feed.scrollTop).toBe(150);
  fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }));
  expect(feed.scrollTop).toBe(500);
  fireEvent.scroll(feed, { target: { scrollTop: 0 } });
  fireEvent.keyDown(feed, { key: 'End' });
  expect(feed.scrollTop).toBe(500);
  fireEvent.keyDown(feed, { key: 'Home' });
  expect(feed.scrollTop).toBe(0);
  fireEvent.scroll(feed, { target: { scrollTop: 400 } });
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  fireEvent.scroll(feed, { target: { scrollTop: 0 } });
  view.rerender(<StatusFeed lines={lines} turnId="t2" />);
  expect(feed.scrollTop).toBe(500);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
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
