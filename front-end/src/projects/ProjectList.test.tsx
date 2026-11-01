import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Project, ProjectListResponse } from '@cdk/contract';
import { App } from '../App';

const project: Project = { id: 'p1', title: 'Cell division', ownerId: 'u1', avenue: 'scorm', targetCourse: null, sessionId: null, createdAt: 1, updatedAt: 1700000000000 };
const list: ProjectListResponse = { items: [
  { project, latestBuild: { id: 'b1', version: 2, status: 'ready', createdAt: 2 } },
  { project: { ...project, id: 'p2', title: 'Older project', avenue: null, updatedAt: 1 }, latestBuild: null },
] };

beforeEach(() => { window.history.replaceState(null, '', '/'); sessionStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

it('shows the server order, metadata, project links and one-click new project link', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(list));
  vi.stubGlobal('fetch', fetch);
  render(<App />);
  const rows = await screen.findAllByRole('listitem');
  expect(rows).toHaveLength(2);
  expect(within(rows[0]!).getByRole('link', { name: project.title })).toHaveAttribute('href', '/?project=p1');
  expect(rows[0]).toHaveTextContent('SCORM');
  expect(rows[0]).toHaveTextContent('Ready · Version 2');
  expect(rows[0]!.querySelector('time')).toHaveAttribute('datetime', new Date(project.updatedAt).toISOString());
  expect(rows[1]).toHaveTextContent('Not selected');
  expect(rows[1]).toHaveTextContent('No build yet');
  expect(screen.getByRole('link', { name: 'New project' })).toHaveAttribute('href', '/?new=1');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('opens creation when the instructor has no projects', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ items: [] })));
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Create an activity' })).toBeVisible();
  expect(screen.getByLabelText('Project title')).toBeEnabled();
});

it('keeps loading failures distinct from an empty list and allows retry', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json(list)));
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load your projects');
  expect(screen.queryByLabelText('Project title')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try loading projects again' }));
  expect(await screen.findByRole('link', { name: project.title })).toBeVisible();
});

it('opens an explicit new project without fetching the list or reusing another project draft', () => {
  window.history.replaceState(null, '', '/?new=1');
  sessionStorage.setItem('request-draft-p1', 'Draft for an existing project');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(<App />);
  expect(screen.getByLabelText('What should students learn or do?')).toHaveValue('');
  expect(fetch).not.toHaveBeenCalled();
});

it('retries opening a project using fresh server metadata and its own draft', async () => {
  window.history.replaceState(null, '', '/?project=p1');
  sessionStorage.setItem('request-draft-p1', 'Keep this draft');
  class Stream extends EventTarget { close() {} }
  vi.stubGlobal('EventSource', Stream);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(async (url: string) =>
    Response.json(url === '/api/projects/p1' ? { project, builds: [] } : { items: [] })));
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to open this project');
  fireEvent.click(screen.getByRole('button', { name: 'Try opening again' }));
  expect(await screen.findByRole('heading', { name: project.title })).toBeVisible();
  await waitFor(() => expect(screen.getByLabelText('Describe a change')).toHaveValue('Keep this draft'));
  expect(screen.getByRole('link', { name: 'My projects' })).toHaveAttribute('href', '/');
});
