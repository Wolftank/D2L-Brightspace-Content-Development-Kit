import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectWorkspace } from './ProjectWorkspace';
import type { Build, Message, Project, ProjectEvent } from '@cdk/contract';

class Stream extends EventTarget {
  static latest: Stream | undefined;
  readyState = 1;
  constructor() { super(); Stream.latest = this; }
  close() {}
  emit(event: ProjectEvent) {
    this.dispatchEvent(new MessageEvent(event.kind, { data: JSON.stringify(event.payload), lastEventId: String(event.seq) }));
  }
}
const project: Project = { id: 'p1', title: 'Cell division', ownerId: 'u1', avenue: 'scorm', targetCourse: null, sessionId: null, createdAt: 1, updatedAt: 1 };
const message = (id: string, seq: number, role: Message['role'], text: string, turnId = 't1'): Message => ({ id, projectId: 'p1', seq, role, content: [{ type: 'text', text }], turnId, createdAt: seq });
const build = (version: number, status: Build['status'] = 'ready'): Build => ({ id: `b${version}`, projectId: 'p1', version, status, avenue: 'scorm', qa: { passed: status === 'ready', findings: [] }, error: null, outputHash: null, pedagogy: null, turnId: 't1', createdAt: version });
let history: Message[];
let sent: number;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv('VITE_PREVIEW_ORIGIN', 'http://127.0.0.1:3002');
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
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function emit(event: ProjectEvent) { act(() => Stream.latest!.emit(event)); }
async function firstRequest() {
  fireEvent.change(screen.getByLabelText('Project title'), { target: { value: 'Cell division' } });
  fireEvent.change(screen.getByLabelText('What should students learn or do?'), { target: { value: 'Create a quiz.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText('Create a quiz.');
  await waitFor(() => expect(Stream.latest).toBeDefined());
  emit({ seq: 1, kind: 'turn.started', payload: { turnId: 't1', startedAt: Date.now() } });
}

it('shows suggestions for the latest build and clears them on the next build', async () => {
  render(<ProjectWorkspace initialProject={project} />);
  await waitFor(() => expect(Stream.latest).toBeDefined());
  emit({ seq: 1, kind: 'build.updated', payload: { build: {
    ...build(1),
    suggestions: [{ framework: 'tilt', principle: 'Criteria', suggestion: 'Include an example.', reason: 'It clarifies the criteria.' }],
  } } });
  const section = screen.getByRole('region', { name: 'Suggestions' });
  expect(within(section).getByRole('listitem')).toHaveTextContent('TILT · Criteria Include an example.');
  expect(section).toHaveTextContent('It clarifies the criteria.');
  emit({ seq: 2, kind: 'build.updated', payload: { build: { ...build(2), suggestions: [] } } });
  expect(screen.queryByRole('region', { name: 'Suggestions' })).not.toBeInTheDocument();
});

describe('F10 conversation', () => {
  it('defaults new projects to Let CDK choose and omits the format', async () => {
    render(<ProjectWorkspace />);

    const auto = screen.getByRole('radio', { name: 'Let CDK choose' });
    expect(auto).toBeChecked();
    expect(auto).toHaveAccessibleDescription('CDK picks the format from your request.');
    const scorm = screen.getByRole('radio', { name: 'SCORM package' });
    expect(scorm).not.toBeChecked();
    expect(scorm).toHaveAccessibleDescription('Can record a grade in D2L.');
    expect(screen.getByRole('radio', { name: 'Content topic' })).not.toBeChecked();
    fetchMock.mockImplementationOnce(async () => Response.json({ project: { ...project, avenue: null } }));
    await firstRequest();
    expect(fetchMock).toHaveBeenCalledWith('/api/projects', expect.objectContaining({
      body: JSON.stringify({ title: 'Cell division' }),
    }));
    expect(screen.getByText('Project', { exact: true })).toBeVisible();
    emit({ seq: 2, kind: 'project.updated', payload: { project: { ...project, avenue: 'topic' } } });
    expect(screen.getByText('Project · Content topic', { exact: true })).toBeVisible();
  });

  it.each([
    ['Content topic', 'topic'],
    ['SCORM package', 'scorm'],
  ])('creates a project with the explicit %s format', async (name, avenue) => {
    render(<ProjectWorkspace />);

    fireEvent.change(screen.getByLabelText('Project title'), {
      target: { value: 'Cell division' },
    });

    const option = screen.getByRole('radio', { name });
    fireEvent.click(option);
    expect(option).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Let CDK choose' })).not.toBeChecked();

    fireEvent.change(screen.getByLabelText('What should students learn or do?'), {
      target: { value: 'Create a lesson.' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            title: 'Cell division',
            avenue,
          }),
        }),
      );
    });

    await waitFor(() => expect(Stream.latest).toBeDefined());
  });
  it('starts from the chat and requires a title and request', () => {
    render(<ProjectWorkspace />);
    expect(screen.getByRole('region', { name: 'Design' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Preview' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a project title and a request');
  });
  it('keeps draft text while running, streams the reply, and continues the same project in order', async () => {
    render(<ProjectWorkspace />); await firstRequest();
    const draft = screen.getByLabelText('Describe a change');
    expect(draft).toHaveFocus();
    fireEvent.change(draft, { target: { value: 'Make buttons larger.' } });
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
    expect(draft).toHaveValue('Make buttons larger.');
    expect(draft).toHaveAccessibleName('Describe a change');
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
    expect(screen.getByText('CDK: Buttons are larger.')).toHaveAttribute('role', 'status');
  });
  it('shows progress in the build panel and separate streamed agent messages after tool calls', async () => {
    const view = render(<ProjectWorkspace />); await firstRequest();
    const chat = screen.getByRole('region', { name: 'Design' });
    const panel = screen.getByRole('region', { name: 'Build' });
    expect(within(panel).getByLabelText('Request progress')).toBeVisible();
    expect(within(chat).queryByLabelText('Request progress')).not.toBeInTheDocument();
    emit({ seq: 2, kind: 'message.delta', payload: { turnId: 't1', messageId: 'a1', text: 'I will ' } });
    emit({ seq: 3, kind: 'message.delta', payload: { turnId: 't1', messageId: 'a1', text: 'edit the activity.' } });
    emit({ seq: 4, kind: 'tool.started', payload: { turnId: 't1', callId: 'edit', name: 'Edit', summary: 'Editing index.html', category: 'writing' as const } });
    emit({ seq: 5, kind: 'tool.finished', payload: { turnId: 't1', callId: 'edit', ok: true, summary: 'Editing index.html', category: 'writing' as const } });
    emit({ seq: 6, kind: 'message.delta', payload: { turnId: 't1', messageId: 'a2', text: 'Ready.' } });
    expect(within(chat).queryByRole('log', { name: 'Build progress' })).not.toBeInTheDocument();
    expect(within(panel).getByRole('log', { name: 'Build progress' })).toHaveTextContent('Updating the activity');
    const thread = screen.getByLabelText('Conversation history');
    expect(within(thread).getAllByRole('article').map(node => node.textContent)).toEqual(['YouCreate a quiz.', 'CDKI will edit the activity.', 'CDKReady.']);
    view.unmount(); render(<ProjectWorkspace initialProject={project} />);
    expect(within(screen.getByLabelText('Conversation history')).getAllByRole('article')).toHaveLength(3);
    emit({ seq: 7, kind: 'message.completed', payload: { message: message('a1', 2, 'agent', 'I will edit the activity.') } });
    emit({ seq: 8, kind: 'message.completed', payload: { message: message('a2', 3, 'agent', 'Ready.') } });
    emit({ seq: 9, kind: 'turn.completed', payload: { turnId: 't1' } });
    expect(within(screen.getByLabelText('Conversation history')).getAllByRole('article')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });
  it('loads server history on reopening and deduplicates replayed replies', async () => {
    history = [message('u1', 1, 'instructor', 'First request'), message('a1', 2, 'agent', 'First reply')];
    render(<ProjectWorkspace initialProject={project} />);
    await screen.findByText('First request');
    emit({ seq: 1, kind: 'message.completed', payload: { message: history[1]! } });
    expect(within(screen.getByLabelText('Conversation history')).getAllByRole('article')).toHaveLength(2);
    emit({ seq: 2, kind: 'turn.started', payload: { turnId: 't2', startedAt: Date.now() } });
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
  });
  it('restores the thread, streaming reply, running turn and draft after reload', async () => {
    const view = render(<ProjectWorkspace />); await firstRequest();
    emit({ seq: 2, kind: 'message.delta', payload: { turnId: 't1', messageId: 'a1', text: 'I am building the quiz.' } });
    fireEvent.change(screen.getByLabelText('Describe a change'), { target: { value: 'Make it shorter next.' } });
    view.unmount();
    render(<ProjectWorkspace initialProject={project} />);
    expect(within(screen.getByLabelText('Conversation history')).getByText('Create a quiz.')).toBeVisible();
    expect(screen.getByText('I am building the quiz.')).toBeVisible();
    expect(screen.getByLabelText('Describe a change')).toHaveValue('Make it shorter next.');
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
  });
  it('can stop a queued request and waits for confirmation before allowing a follow-up', async () => {
    render(<ProjectWorkspace initialProject={project} initialTurnId="queued-turn" />);
    const stop = screen.getByRole('button', { name: 'Stop request' });
    fetchMock.mockResolvedValueOnce(Response.json({ error: { message: 'Service unavailable.', nextStep: 'try_later' } }, { status: 503 }));
    fireEvent.click(stop);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to stop the request. Service unavailable.');
    expect(stop).toBeEnabled();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }));
    await act(async () => { fireEvent.click(stop); });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/turns/queued-turn/cancel', { method: 'POST' });
    expect(screen.getByRole('button', { name: 'Stopping…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
    emit({ seq: 1, kind: 'turn.cancelled', payload: { turnId: 'queued-turn' } });
    expect(screen.queryByRole('button', { name: 'Stopping…' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(screen.getByText('Request stopped. You can send a follow-up.')).toHaveAttribute('role', 'status');
  });

  it('shows a cancelled request in the conversation', async () => {
    render(<ProjectWorkspace />); await firstRequest();
    emit({ seq: 2, kind: 'turn.cancelled', payload: { turnId: 't1' } });
    expect(within(screen.getByLabelText('Conversation history')).getByText('Request stopped.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });
  it('replaces the latest build while retaining the last ready preview after QA failure', async () => {
    render(<ProjectWorkspace />); await firstRequest();
    emit({ seq: 2, kind: 'build.updated', payload: { build: build(1) } });
    expect(screen.getByTitle('Interactive preview of build 1')).toHaveAttribute('src', expect.stringContaining('buildId=b1'));
    emit({ seq: 3, kind: 'build.updated', payload: { build: build(2, 'failed') } });
    expect(screen.getByText('Version 2')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Download SCORM package' })).not.toBeInTheDocument();
    expect(screen.getByTitle('Interactive preview of build 1')).toBeInTheDocument();
    emit({ seq: 4, kind: 'build.updated', payload: { build: build(3) } });
    expect(screen.getByTitle('Interactive preview of build 3')).toBeInTheDocument();
    expect(screen.queryByTitle('Interactive preview of build 1')).not.toBeInTheDocument();
    const frame = screen.getByTitle('Interactive preview of build 3');
    fireEvent.click(screen.getByRole('button', { name: 'Restart preview' }));
    expect(screen.getByTitle('Interactive preview of build 3')).not.toBe(frame);
  });
  it('asks a signed-out instructor to sign in, and enables Send when they come back to the window signed in', async () => {
    let signedIn = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url !== '/api/agent/sign-in') return Response.json({ agent: { name: 'claude', ok: signedIn } });
      signedIn = true;
      return new Response(null, { status: 202 });
    });
    render(<ProjectWorkspace />);
    expect(await screen.findByText('Sign in to Claude to send requests.')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Claude' }));
    expect(await screen.findByText('Finish signing in in the browser tab that just opened, then come back here.')).toBeVisible();
    await waitFor(() => { fireEvent.focus(window); expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled(); });
    expect(screen.queryByRole('button', { name: 'Sign in to Claude' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('What should students learn or do?')).toHaveFocus();
  });
  it('shows a failed request and allows a follow-up with the draft kept on send failure', async () => {
    render(<ProjectWorkspace />); await firstRequest();
    emit({ seq: 2, kind: 'turn.failed', payload: { turnId: 't1', error: { code: 'agent_error', message: 'The agent stopped before it finished.', nextStep: 'send_again' } } });
    expect(within(screen.getByLabelText('Conversation history')).getByText('The agent stopped before it finished.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Describe a change'), { target: { value: 'Try a shorter quiz.' } });
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: 'offline', message: 'Unable to reach the service.', nextStep: 'try_later' } }, { status: 503 }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText('Unable to reach the service.')).toHaveAttribute('role', 'alert'));
    expect(screen.getByLabelText('Describe a change')).toHaveValue('Try a shorter quiz.');
  });
});

it('refuses individual files, removes a file, and uploads the rest before sending', async () => {
  const entry = { id: 'f1', projectId: project.id, name: 'syllabus.txt', mime: 'text/plain', size: 4, createdAt: 1 };
  const upload = vi.fn(() => Response.json({ file: entry }, { status: 201 }));
  const post = vi.fn((content: Message['content']) => Response.json({ message: { ...message('u1', 1, 'instructor', ''), content }, turn: { id: 't1' } }));
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/files')) return upload();
    if (init?.method === 'POST') return post(JSON.parse(init.body as string).content);
    return Response.json({ items: [] });
  });
  const view = render(<ProjectWorkspace initialProject={project} />);
  const attach = screen.getByRole('button', { name: 'Attach files' });
  expect(attach).toHaveAttribute('title', expect.stringContaining('Do not attach student information'));
  fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [
    new File(['text'], 'syllabus.txt', { type: 'text/plain' }),
    new File(['text'], 'notes.txt', { type: 'text/plain' }),
    new File(['binary'], 'image.gif', { type: 'image/gif' }),
  ] } });
  expect(screen.getByRole('alert')).toHaveTextContent('image.gif');
  fireEvent.click(screen.getByRole('button', { name: 'Remove notes.txt' }));
  expect(upload).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Describe a change'), { target: { value: 'Use the syllabus.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(post).toHaveBeenCalledWith([{ type: 'text', text: 'Use the syllabus.' }, { type: 'file', fileId: 'f1' }]));
  expect(upload).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls.find(([url]) => String(url).endsWith('/files'))?.[1].body.get('file').name).toBe('syllabus.txt');
  expect(await within(screen.getByLabelText('Conversation history')).findByText('syllabus.txt')).toBeVisible();
});

it('keeps the draft when an upload fails and reuses successful uploads on retry', async () => {
  const entry = { id: 'f1', projectId: project.id, name: 'notes.txt', mime: 'text/plain', size: 4, createdAt: 1 };
  const uploads: string[] = [];
  const post = vi.fn((content: Message['content']) => Response.json({ message: { ...message('u1', 1, 'instructor', ''), content }, turn: { id: 't1' } }));
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/files')) {
      const file = (init?.body as FormData).get('file') as File;
      uploads.push(file.name);
      if (uploads.length === 2) return Response.json({ error: { code: 'file_not_accepted', message: 'This file could not be attached.', nextStep: 'send_again' } }, { status: 422 });
      return Response.json({ file: file.name === 'notes.txt' ? entry : { ...entry, id: 'f2', name: file.name } }, { status: 201 });
    }
    if (init?.method === 'POST') return post(JSON.parse(init.body as string).content);
    return Response.json({ items: [] });
  });
  const view = render(<ProjectWorkspace initialProject={project} />);
  fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [
    new File(['text'], 'notes.txt', { type: 'text/plain' }),
    new File(['more'], 'more.txt', { type: 'text/plain' }),
  ] } });
  const draft = screen.getByLabelText('Describe a change');
  const send = screen.getByRole('button', { name: 'Send' });
  fireEvent.change(draft, { target: { value: 'Use my notes.' } });
  fireEvent.click(send);
  expect(await screen.findByText(/Could not upload more.txt/)).toHaveTextContent('Your message was not sent.');
  expect(post).not.toHaveBeenCalled();
  expect(draft).toHaveValue('Use my notes.');
  expect(screen.getByRole('button', { name: 'Remove more.txt' })).toBeEnabled();
  fireEvent.click(send);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(uploads).toEqual(['notes.txt', 'more.txt', 'more.txt']);
});

describe('format of an open project', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => Response.json(init?.method === 'PATCH'
      ? { project: { ...project, avenue: JSON.parse(init.body as string).avenue, updatedAt: 2 } }
      : { items: [] }));
  });

  it('offers Let CDK choose until the project has a format, and changes it without asking before the first version', async () => {
    render(<ProjectWorkspace initialProject={{ ...project, avenue: null }} />);
    const format = screen.getByLabelText('Format');
    expect(format).toHaveValue('auto');

    fireEvent.change(format, { target: { value: 'scorm' } });

    await waitFor(() => expect(format).toHaveValue('scorm'));
    expect(within(format).getAllByRole('option').map(option => option.textContent)).toEqual(['SCORM package', 'Content topic']);
    expect(screen.getByLabelText('Describe a change')).toHaveValue('');
  });

  it('asks before changing the format of a project with a version, then drafts a request to rebuild it', async () => {
    render(<ProjectWorkspace initialProject={project} />);
    await waitFor(() => expect(Stream.latest).toBeDefined());
    emit({ seq: 1, kind: 'build.created', payload: { build: build(1) } });

    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'topic' } });
    const confirmation = screen.getByRole('group', { name: 'Change format' });
    expect(confirmation).toHaveTextContent('Change to Content topic?');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/projects/p1', expect.anything());
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Change format' }));

    await waitFor(() => expect(screen.getByLabelText('Describe a change')).toHaveValue('Rebuild this activity as a content topic.'));
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/p1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ avenue: 'topic' }) }));
    expect(screen.getByText('Project · Content topic', { exact: true })).toBeVisible();
  });
});
