import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewPanel } from './PreviewPanel';
import { previewSession } from './session';

beforeEach(() => vi.stubEnv('VITE_PREVIEW_ORIGIN', 'http://127.0.0.1:3002'));
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

function frame() { return screen.getByTitle('Interactive preview of build 3') as HTMLIFrameElement; }
function report(status: string, overrides: MessageEventInit = {}, reason?: string) {
  const iframe = frame();
  const url = new URL(iframe.src);
  act(() => window.dispatchEvent(new MessageEvent('message', {
    origin: url.origin, source: iframe.contentWindow,
    data: { type: 'cdk-preview', status, buildId: 'saved-3', attempt: url.searchParams.get('attempt'), reason },
    ...overrides,
  })));
}

describe('PreviewPanel', () => {
  it('loads the selected version in an isolated, titled frame and focuses the heading', () => {
    render(<PreviewPanel build={{ id: 'saved-3', version: 3 }} onClose={vi.fn()} />);
    expect(screen.getByRole('heading')).toHaveFocus();
    expect(screen.getByText('Local preview — results are not sent to Brightspace.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading preview');
    expect(new URL(frame().src).searchParams.get('buildId')).toBe('saved-3');
    expect(frame()).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
    expect(frame()).not.toBeVisible();
    report('ready');
    expect(frame()).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Preview ready');
  });

  it('ignores messages from another origin, window, build or attempt', () => {
    render(<PreviewPanel build={{ id: 'saved-3', version: 3 }} onClose={vi.fn()} />);
    report('ready', { origin: window.location.origin });
    report('ready', { source: window });
    report('ready', { data: { type: 'cdk-preview', status: 'ready', buildId: 'other' } });
    report('ready', { data: { type: 'cdk-preview', status: 'ready', buildId: 'saved-3', attempt: 'old' } });
    expect(screen.getByRole('status')).toHaveTextContent('Loading preview');
  });

  it('restarts with a new frame and attempt, preserving the selected build', () => {
    render(<PreviewPanel build={{ id: 'saved-3', version: 3 }} onClose={vi.fn()} />);
    const previous = frame();
    const url = previous.src;
    report('ready');
    fireEvent.click(screen.getByRole('button', { name: 'Restart preview' }));
    expect(previous.isConnected).toBe(false);
    expect(frame().src).not.toBe(url);
    expect(new URL(frame().src).searchParams.get('buildId')).toBe('saved-3');
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  it.each(['unavailable', 'launch'])('offers retry after %s failure', (reason) => {
    render(<PreviewPanel build={{ id: 'saved-3', version: 3 }} onClose={vi.fn()} />);
    const previous = frame();
    report('error', {}, reason);
    expect(screen.getByRole('alert')).toHaveTextContent(reason === 'unavailable' ? 'saved build is unavailable' : 'could not be opened');
    expect(previous.isConnected).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
    expect(frame().src).not.toBe(previous.src);
  });

  it('times out an unreachable service and cleans up on unmount', () => {
    vi.useFakeTimers();
    const { unmount } = render(<PreviewPanel build={{ id: 'saved-3', version: 3 }} onClose={vi.fn()} />);
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.getByRole('alert')).toHaveTextContent('could not be opened');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('calls close and handles missing configuration', () => {
    vi.stubEnv('VITE_PREVIEW_ORIGIN', '');
    const close = vi.fn();
    render(<PreviewPanel build={{ id: 'saved-3', version: 3 }} onClose={close} />);
    expect(screen.getByRole('alert')).toHaveTextContent('has not been configured');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('refuses a player hosted on the application origin', () => {
    vi.stubEnv('VITE_PREVIEW_ORIGIN', window.location.origin);
    expect(() => previewSession('saved-3')).toThrow('separate preview origin');
  });
});
