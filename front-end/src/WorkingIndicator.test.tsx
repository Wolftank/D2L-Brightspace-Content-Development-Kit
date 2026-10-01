import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkingIndicator } from './WorkingIndicator';

afterEach(() => vi.useRealTimers());

describe('WorkingIndicator', () => {
  it('counts from the recorded start, including after remount, without announcing ticks or moving focus', () => {
    vi.useFakeTimers();
    vi.setSystemTime(65_000);
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const view = render(<WorkingIndicator startedAt={1000} step="Thinking…" connection="connected" />);
    expect(screen.getByLabelText('Elapsed time')).toHaveTextContent('1:04');
    expect(screen.getByLabelText('Elapsed time')).toHaveAttribute('aria-live', 'off');
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByLabelText('Elapsed time')).toHaveTextContent('1:06');
    expect(document.activeElement).toBe(opener);
    view.unmount();
    render(<WorkingIndicator startedAt={1000} step="Thinking…" connection="connected" />);
    expect(screen.getByLabelText('Elapsed time')).toHaveTextContent('1:06');
    opener.remove();
  });

  it('shows the fallback and connection states', () => {
    const view = render(<WorkingIndicator startedAt={Date.now()} step="" connection="connected" />);
    expect(screen.getByText('Working on your request')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    view.rerender(<WorkingIndicator startedAt={Date.now()} step="Writing index.html" connection="reconnecting" />);
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');
    view.rerender(<WorkingIndicator startedAt={Date.now()} step="Writing index.html" connection="lost" />);
    expect(screen.getByRole('status')).toHaveTextContent('Connection lost. Reload the page to reconnect.');
  });
});
