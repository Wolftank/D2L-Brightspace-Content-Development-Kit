import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { Build, Message, ProjectEvent } from './api/types';

class Stream extends EventTarget {
  static latest: Stream | undefined;
  readyState = 1;
  constructor() { super(); Stream.latest = this; }
  close() {}
  emit(event: ProjectEvent) {
    this.dispatchEvent(new MessageEvent(event.kind, { data: JSON.stringify(event.payload), lastEventId: String(event.seq) }));
  }
}
const project = { id: 'p1', title: 'Cell division' };
const message = (id: string, seq: number, role: Message['role'], text: string, turnId = 't1'): Message => ({ id, projectId: 'p1', seq, role, content: [{ type: 'text', text }], turnId, createdAt: seq });
const build = (version: number, status: Build['status'] = 'ready'): Build => ({ id: `b${version}`, projectId: 'p1', version, status, avenue: 'scorm', qa: { passed: status === 'ready', findings: [] }, error: null, outputHash: null, pedagogy: null, turnId: 't1', createdAt: version });
let history: Message[];
let sent: number;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sessionStorage.clear(); history = []; sent = 0; Stream.latest = undefined;
  vi.stubGlobal('EventSource', Stream);
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/projects') return Response.json({ project });
    if (!init?.method) return Response.json({ items: history });
    const text = JSON.parse(init.body as string).content[0].text;
    const request = message(`u${++sent}`, sent * 2 - 1, 'instructor', text, `t${sent}`);
    return Response.json({ message: request, turn: { id: `t${sent}` } });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); });
function emit(event: ProjectEvent) { act(() => Stream.latest!.emit(event)); }
async function firstRequest() {
  fireEvent.change(screen.getByLabelText('Project title'), { target: { value: 'Cell division' } });
  fireEvent.change(screen.getByLabelText('What should students learn or do?'), { target: { value: 'Create a quiz.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText('Create a quiz.');
  await waitFor(() => expect(Stream.latest).toBeDefined());
  emit({ seq: 1, kind: 'turn.started', payload: { turnId: 't1', startedAt: Date.now() } });
}

describe('F10 conversation', () => {
  it('starts from the chat and requires a title and request', () => {
    render(<App />);
    expect(screen.getByRole('region', { name: 'Conversation' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Preview' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a project title and a request');
  });
  it('keeps draft text while running, streams the reply, and continues the same project in order', async () => {
    render(<App />); await firstRequest();
    const draft = screen.getByLabelText('Describe a change');
    expect(draft).toHaveFocus();
    fireEvent.change(draft, { target: { value: 'Make buttons larger.' } });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(draft).toHaveValue('Make buttons larger.');
    expect(screen.getByText(/You can draft your next message/)).toBeVisible();
    emit({ seq: 2, kind: 'message.delta', payload: { turnId: 't1', messageId: 'a1', text: 'Building your quiz…' } });
    expect(screen.getByText('Building your quiz…')).toBeVisible();
    emit({ seq: 3, kind: 'message.completed', payload: { message: message('a1', 2, 'agent', 'Your quiz is ready.') } });
    emit({ seq: 4, kind: 'turn.completed', payload: { turnId: 't1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Make buttons larger.');
    emit({ seq: 5, kind: 'turn.started', payload: { turnId: 't2', startedAt: Date.now() } });
    emit({ seq: 6, kind: 'message.completed', payload: { message: message('a2', 4, 'agent', 'Buttons are larger.', 't2') } });
    emit({ seq: 7, kind: 'turn.completed', payload: { turnId: 't2' } });
    const thread = screen.getByLabelText('Conversation history');
    expect(within(thread).getAllByRole('article').map(node => node.textContent)).toEqual(['YouCreate a quiz.', 'CDKYour quiz is ready.', 'YouMake buttons larger.', 'CDKButtons are larger.']);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/projects')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('CDK: Buttons are larger.');
  });
  it('loads server history on reopening and deduplicates replayed replies', async () => {
    history = [message('u1', 1, 'instructor', 'First request'), message('a1', 2, 'agent', 'First reply')];
    sessionStorage.setItem('active-project', JSON.stringify(project));
    render(<App />);
    await screen.findByText('First request');
    emit({ seq: 1, kind: 'message.completed', payload: { message: history[1]! } });
    expect(within(screen.getByLabelText('Conversation history')).getAllByRole('article')).toHaveLength(2);
    emit({ seq: 2, kind: 'turn.started', payload: { turnId: 't2', startedAt: Date.now() } });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
  it('restores the thread, streaming reply, running turn and draft after reload', async () => {
    const view = render(<App />); await firstRequest();
    emit({ seq: 2, kind: 'message.delta', payload: { turnId: 't1', messageId: 'a1', text: 'I am building the quiz.' } });
    fireEvent.change(screen.getByLabelText('Describe a change'), { target: { value: 'Make it shorter next.' } });
    view.unmount();
    render(<App />);
    expect(within(screen.getByLabelText('Conversation history')).getByText('Create a quiz.')).toBeVisible();
    expect(screen.getByText('I am building the quiz.')).toBeVisible();
    expect(screen.getByLabelText('Describe a change')).toHaveValue('Make it shorter next.');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
  it('shows a cancelled request in the conversation', async () => {
    render(<App />); await firstRequest();
    emit({ seq: 2, kind: 'turn.cancelled', payload: { turnId: 't1' } });
    expect(within(screen.getByLabelText('Conversation history')).getByText('This request was cancelled.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });
  it('replaces the latest build while retaining the last ready preview after QA failure', async () => {
    render(<App />); await firstRequest();
    emit({ seq: 2, kind: 'build.updated', payload: { build: build(1) } });
    expect(screen.getByTitle('Activity preview, version 1')).toHaveAttribute('src', '/api/builds/b1/preview/');
    emit({ seq: 3, kind: 'build.updated', payload: { build: build(2, 'failed') } });
    expect(screen.getByText('BUILD 2')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Download SCORM package' })).not.toBeInTheDocument();
    expect(screen.getByTitle('Activity preview, version 1')).toBeVisible();
    emit({ seq: 4, kind: 'build.updated', payload: { build: build(3) } });
    expect(screen.getByTitle('Activity preview, version 3')).toBeVisible();
    expect(screen.queryByTitle('Activity preview, version 1')).not.toBeInTheDocument();
    const frame = screen.getByTitle('Activity preview, version 3');
    fireEvent.click(screen.getByRole('button', { name: 'Restart preview' }));
    expect(screen.getByTitle('Activity preview, version 3')).not.toBe(frame);
  });
  it('shows a failed request and allows a follow-up with the draft kept on send failure', async () => {
    render(<App />); await firstRequest();
    emit({ seq: 2, kind: 'turn.failed', payload: { turnId: 't1', error: { code: 'agent_error', message: 'The agent stopped before it finished.' } } });
    expect(within(screen.getByLabelText('Conversation history')).getByText('The agent stopped before it finished.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Describe a change'), { target: { value: 'Try a shorter quiz.' } });
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: 'offline', message: 'Unable to reach the service.' } }, { status: 503 }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to reach the service.'));
    expect(screen.getByLabelText('Describe a change')).toHaveValue('Try a shorter quiz.');
  });
});
