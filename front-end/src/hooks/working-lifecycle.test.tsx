import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../App';
import { useProjectEvents } from './useProjectEvents';

class Stream extends EventTarget {
  static instances: Stream[] = [];
  readyState = 0;
  close = vi.fn(() => { this.readyState = 2; });
  constructor(public url: string) { super(); Stream.instances.push(this); }
  emit(kind: string, payload: unknown, seq: number) {
    this.dispatchEvent(new MessageEvent(kind, { data: JSON.stringify(payload), lastEventId: String(seq) }));
  }
}

afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); Stream.instances = []; });

it.each(['turn.completed', 'turn.failed', 'turn.cancelled'])('removes the indicator on %s', (kind) => {
  vi.stubGlobal('EventSource', Stream);
  sessionStorage.setItem('active-project', JSON.stringify({ id: 'p1' }));
  render(<App />);
  const stream = Stream.instances.at(-1)!;
  act(() => {
    stream.dispatchEvent(new Event('open'));
    stream.emit('turn.started', { turnId: 't1', startedAt: Date.now() - 5000 }, 1);
  });
  expect(screen.getByLabelText('Request progress')).toBeInTheDocument();
  act(() => stream.emit(kind, { turnId: 't1', error: { code: 'failed', message: 'Failed' } }, 2));
  expect(screen.queryByLabelText('Request progress')).not.toBeInTheDocument();
});

it('restores the real start and current step after reload and resumes at the saved sequence', () => {
  vi.stubGlobal('EventSource', Stream);
  const first = renderHook(() => useProjectEvents('p1'));
  act(() => {
    Stream.instances[0]!.emit('turn.started', { turnId: 't1', startedAt: 1000 }, 1);
    Stream.instances[0]!.emit('turn.status', { turnId: 't1', text: 'Thinking…' }, 2);
  });
  first.unmount();
  const restored = renderHook(() => useProjectEvents('p1'));
  expect(restored.result.current.turn).toMatchObject({ startedAt: 1000, currentStep: 'Thinking…', status: 'running' });
  expect(Stream.instances[1]!.url).toContain('after=2');
});

it('recovers on open and stops retrying after 30 seconds without recovery', () => {
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', Stream);
  const hook = renderHook(() => useProjectEvents('p1'));
  const stream = Stream.instances[0]!;
  act(() => stream.dispatchEvent(new Event('error')));
  expect(hook.result.current.connection).toBe('reconnecting');
  act(() => { vi.advanceTimersByTime(20_000); stream.dispatchEvent(new Event('open')); });
  expect(hook.result.current.connection).toBe('connected');
  act(() => vi.advanceTimersByTime(30_000));
  expect(stream.close).not.toHaveBeenCalled();
  act(() => { stream.dispatchEvent(new Event('error')); vi.advanceTimersByTime(30_000); });
  expect(hook.result.current.connection).toBe('lost');
  expect(stream.close).toHaveBeenCalledOnce();
});

