import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { BuildStatus } from '../api/types';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('offers preview only for ready builds, pins the selected version, switches and restores focus', async () => {
  const listeners = new Map<string, (event: MessageEvent) => void>();
  vi.stubEnv('VITE_PREVIEW_ORIGIN', 'http://127.0.0.1:3002');
  vi.stubGlobal('EventSource', class {
    addEventListener(kind: string, listener: (event: MessageEvent) => void) { listeners.set(kind, listener); }
    close() {}
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ project: { id: 'p1', title: 'Quiz' } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: {}, turn: {} }))));
  render(<App />);
  fireEvent.change(screen.getByLabelText('Project title'), { target: { value: 'Quiz' } });
  fireEvent.change(screen.getByLabelText('What should students learn or do?'), { target: { value: 'Practice' } });
  fireEvent.click(screen.getByRole('button', { name: 'Build activity' }));
  await waitFor(() => expect(listeners.has('build.updated')).toBe(true));
  function update(status: BuildStatus, version = 1) {
    act(() => listeners.get('build.updated')!(new MessageEvent('build.updated', {
      data: JSON.stringify({ build: { id: `b${version}`, version, status, qa: null } }),
    })));
  }
  update('checking');
  expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
  update('failed');
  expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
  update('ready');
  const opener = screen.getByRole('button', { name: 'Preview' });
  expect(screen.getByRole('link', { name: 'Download SCORM package' })).toHaveAttribute('href', '/api/builds/b1/download');
  fireEvent.click(opener);
  const previous = screen.getByTitle('Interactive preview of build 1');
  update('ready', 2);
  expect(screen.getByTitle('Interactive preview of build 1')).toBe(previous);
  expect(screen.getByRole('link', { name: 'Download SCORM package' })).toHaveAttribute('href', '/api/builds/b2/download');
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  expect(previous.isConnected).toBe(false);
  expect(screen.getByTitle('Interactive preview of build 2')).toHaveAttribute('src', expect.stringContaining('buildId=b2'));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByTitle('Interactive preview of build 2')).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});
