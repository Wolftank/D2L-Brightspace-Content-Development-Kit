import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Build, Message } from '@cdk/contract';
import {
  initialProjectEventState,
  projectEventReducer,
  useProjectEvents,
  type ProjectEventState,
} from './useProjectEvents';

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  getMessages: vi.fn(() => new Promise(() => undefined)),
}));

describe('projectEventReducer', () => {
  it('handles turn.started', () => {
    const result = projectEventReducer(initialProjectEventState, {
      seq: 1,
      kind: 'turn.started',
      payload: {
        startedAt: 1000,
        turnId: 'turn-1',
      },
    });

    expect(result.turn).toEqual({
      id: 'turn-1',
      status: 'running',
      startedAt: 1000,
      currentStep: '',
    });

    expect(result.statusLines).toEqual([
      {
        seq: 1,
        text: 'Starting your build',
      },
    ]);
  });

  it('handles turn.status', () => {
    const result = projectEventReducer(initialProjectEventState, {
      seq: 2,
      kind: 'turn.status',
      payload: {
        turnId: 'turn-1',
        text: 'Running quality checks',
        category: 'other' as const,
      },
    });

    expect(result.statusLines.at(-1)).toEqual({
      seq: 2,
      text: 'Running quality checks',
      category: 'other',
    });
  });

  it('handles message.delta', () => {
    const first = projectEventReducer(initialProjectEventState, {
      seq: 3,
      kind: 'message.delta',
      payload: {
        turnId: 'turn-1',
        messageId: 'message-1',
        text: 'Hello ',
      },
    });

    const second = projectEventReducer(first, {
      seq: 4,
      kind: 'message.delta',
      payload: {
        turnId: 'turn-1',
        messageId: 'message-1',
        text: 'world',
      },
    });

    expect(second.streamingMessages).toEqual([{ id: 'message-1', turnId: 'turn-1', text: 'Hello world' }]);
  });

  it('handles message.completed', () => {
    const result = projectEventReducer(initialProjectEventState, {
      seq: 5,
      kind: 'message.completed',
      payload: {
        message: {
          id: 'message-1',
          projectId: 'project-1',
          seq: 1,
          role: 'agent',
          content: [
            {
              type: 'text',
              text: 'Finished',
            },
          ],
          turnId: 'turn-1',
          createdAt: 1,
        },
      },
    });

    expect(result.messages[0]?.content).toEqual([{ type: 'text', text: 'Finished' }]);
    expect(result.streamingMessages).toEqual([]);
  });

  it('handles tool.started', () => {
    const result = projectEventReducer(initialProjectEventState, {
      seq: 6,
      kind: 'tool.started',
      payload: {
        turnId: 'turn-1',
        callId: 'call-1',
        name: 'builder',
        summary: 'Generating activity',
        category: 'other' as const,
      },
    });

    expect(result.statusLines.at(-1)).toEqual({
      seq: 6,
      text: 'Generating activity',
      category: 'other',
      callId: 'call-1',
    });
  });

  it('handles tool.finished', () => {
    const result = projectEventReducer(initialProjectEventState, {
      seq: 7,
      kind: 'tool.finished',
      payload: {
        turnId: 'turn-1',
        callId: 'call-1',
        ok: true,
        summary: 'Activity generated',
        category: 'other' as const,
      },
    });

    expect(result.statusLines).toEqual([]);
  });

  it('handles build.created', () => {
  const result = projectEventReducer(initialProjectEventState, {
    seq: 8,
    kind: 'build.created',
    payload: {
      build: {
        id: 'build-1',
        projectId: 'project-1',
        version: 1,
        status: 'checking',
        avenue: 'scorm',
        qa: null,
        pedagogy: null,
        error: null,
        outputHash: null,
        turnId: 'turn-1',
        createdAt: 1,
      },
    },
  });

  expect(result.builds).toHaveLength(1);
  const build = result.builds[0];

  expect(build).toBeDefined();
  expect(build?.id).toBe('build-1');
  expect(build?.status).toBe('checking');
});

it('handles build.updated by replacing the existing build', () => {
  const created = projectEventReducer(initialProjectEventState, {
    seq: 9,
    kind: 'build.created',
    payload: {
      build: {
        id: 'build-1',
        projectId: 'project-1',
        version: 1,
        status: 'checking',
        avenue: 'scorm',
        qa: null,
        pedagogy: null,
        error: null,
        outputHash: null,
        turnId: 'turn-1',
        createdAt: 1,
      },
    },
  });

  const updated = projectEventReducer(created, {
    seq: 10,
    kind: 'build.updated',
    payload: {
      build: {
        id: 'build-1',
        projectId: 'project-1',
        version: 1,
        status: 'ready',
        avenue: 'scorm',
        qa: {
          passed: true,
          findings: [],
        },
        pedagogy: null,
        error: null,
        outputHash: null,
        turnId: 'turn-1',
        createdAt: 1,
      },
    },
  });

    expect(updated.builds).toHaveLength(1);
    const updatedBuild = updated.builds[0];

    expect(updatedBuild).toBeDefined();
    expect(updatedBuild?.status).toBe('ready');
    expect(updatedBuild?.qa?.passed).toBe(true);
  });

  it('handles deployment.updated', () => {
    const result = projectEventReducer(initialProjectEventState, {
      seq: 11,
      kind: 'deployment.updated',
      payload: {
        deployment: {
          id: 'deployment-1',
          buildId: 'build-1',
          status: 'verified',
          targetCourse: 'BIO 101',
          location: 'module-1',
          verification: null,
          turnId: 'turn-1',
          confirmedAt: 1,
          createdAt: 1,
        },
      },
    });

    expect(result).toEqual(initialProjectEventState);
  });

  it('handles turn.completed', () => {
    const runningState = projectEventReducer(initialProjectEventState, {
      seq: 12,
      kind: 'turn.started',
      payload: {
        startedAt: 1000,
        turnId: 'turn-1',
      },
    });

    const result = projectEventReducer(runningState, {
      seq: 13,
      kind: 'turn.completed',
      payload: {
        turnId: 'turn-1',
      },
    });

    expect(result.turn).toEqual({
      id: 'turn-1',
      status: 'completed',
      startedAt: 1000,
      currentStep: '',
    });

    expect(result.statusLines.at(-1)).toEqual({
      seq: 13,
      text: 'Build complete',
    });
  });

  it('handles turn.failed', () => {
    const result = projectEventReducer(initialProjectEventState, {
      seq: 14,
      kind: 'turn.failed',
      payload: {
        turnId: 'turn-1',
        error: {
          code: 'build_failed',
          message: 'The build could not be completed',
          nextStep: 'send_again',
        },
      },
    });

    expect(result.turn).toEqual({
      id: 'turn-1',
      status: 'failed',
      startedAt: null,
      currentStep: '',
    });

    expect(result.statusLines.at(-1)).toEqual({
      seq: 14,
      text: 'The build could not be completed',
    });
  });

  it('handles turn.cancelled', () => {
    const result = projectEventReducer(initialProjectEventState, {
      seq: 15,
      kind: 'turn.cancelled',
      payload: {
        turnId: 'turn-1',
      },
    });

    expect(result.turn).toEqual({
      id: 'turn-1',
      status: 'cancelled',
      startedAt: null,
      currentStep: '',
    });

    expect(result.statusLines.at(-1)).toEqual({
      seq: 15,
      text: 'Request stopped',
    });
  });

  it('clears the previous reply when a new turn starts', () => {
    const afterFirstTurn = {
      ...initialProjectEventState,
      turn: { id: 'turn-1', status: 'completed' as const, startedAt: 1000, currentStep: 'Checking your build' },
      streamingMessages: [{ id: 'message-1', turnId: 'turn-1', text: 'First reply.' }],
    };

    const started = projectEventReducer(afterFirstTurn, {
      seq: 20,
      kind: 'turn.started',
      payload: { turnId: 'turn-2', startedAt: 2000 },
    });

    expect(started.streamingMessages).toEqual([]);
    expect(started.turn).toMatchObject({ startedAt: 2000, currentStep: '', status: 'running' });

    const streaming = projectEventReducer(started, {
      seq: 21,
      kind: 'message.delta',
      payload: { turnId: 'turn-2', messageId: 'message-2', text: 'Second' },
    });

    expect(streaming.streamingMessages[0]?.text).toBe('Second');
  });
});

it('keeps thinking out of progress history across replay and replaces the active step on tools and replies', () => {
  const events: Parameters<typeof projectEventReducer>[1][] = [
    { seq: 1, kind: 'turn.started', payload: { turnId: 't1', startedAt: 1000 } },
    { seq: 2, kind: 'turn.status', payload: { turnId: 't1', text: 'Internal thinking text', category: 'thinking' } },
    { seq: 3, kind: 'tool.started', payload: { turnId: 't1', callId: 'c1', name: 'Write', summary: 'Updating the activity', category: 'writing' } },
    { seq: 4, kind: 'turn.status', payload: { turnId: 't1', text: 'Thinking…', category: 'thinking' } },
    { seq: 5, kind: 'message.delta', payload: { turnId: 't1', messageId: 'm1', text: 'Here is the activity' } },
    { seq: 6, kind: 'turn.completed', payload: { turnId: 't1' } },
  ];
  let state = initialProjectEventState;
  for (const event of events) {
    state = projectEventReducer(state, event);
    expect(state.statusLines.some(line => /thinking/i.test(line.text))).toBe(false);
    if ('seq' in event && event.seq === 2 || 'seq' in event && event.seq === 4) expect(state.turn.currentStep).toBe('Thinking…');
    if ('seq' in event && event.seq === 3) expect(state.turn.currentStep).toBe('Updating the activity');
    if ('seq' in event && event.seq === 5) expect(state.turn.currentStep).toBe('Writing your reply');
  }
  expect(events.reduce(projectEventReducer, initialProjectEventState)).toEqual(state);
});

class Stream extends EventTarget {
  static instances: Stream[] = [];
  readyState = 0;
  close = vi.fn(() => { this.readyState = 2; });
  constructor(public url: string) { super(); Stream.instances.push(this); }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
  drop() {
    this.readyState = 0;
    this.dispatchEvent(new Event('error'));
  }
  closePermanently() {
    this.readyState = 2;
    this.dispatchEvent(new Event('error'));
  }
  emit(kind: string, payload: unknown, seq: number) {
    this.dispatchEvent(new MessageEvent(kind, { data: JSON.stringify(payload), lastEventId: String(seq) }));
  }
}

function eventStateOf({ turn, statusLines, streamingMessages, builds, messages, outcomes }: ProjectEventState): ProjectEventState {
  return { turn, statusLines, streamingMessages, builds, messages, outcomes };
}

function lineTexts(state: ProjectEventState): string[] {
  return state.statusLines.map(line => line.text);
}

function build(status: Build['status']): Build {
  return { id: 'build-1', projectId: 'p1', version: 1, status, avenue: 'scorm', qa: null, pedagogy: null, error: null, outputHash: null, turnId: 't1', createdAt: 1 };
}

function chatMessage(id: string, seq: number, role: Message['role'], turnId: string, text: string): Message {
  return { id, projectId: 'p1', seq, role, content: [{ type: 'text', text }], turnId, createdAt: seq };
}

describe('useProjectEvents', () => {
  beforeEach(() => { vi.stubGlobal('EventSource', Stream); });

  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Stream.instances = [];
  });

  describe('duplicate events', () => {
    it('ignores a replayed event at or below the last saved sequence', () => {
      const hook = renderHook(() => useProjectEvents('p1'));
      const stream = Stream.instances[0]!;
      act(() => {
        stream.open();
        stream.emit('turn.started', { turnId: 't1', startedAt: 1000 }, 1);
        stream.emit('turn.status', { turnId: 't1', text: 'Checking the outline', category: 'checking' }, 2);
        stream.emit('message.delta', { turnId: 't1', messageId: 'm1', text: 'Here is the quiz' }, 3);
        stream.emit('build.created', { build: build('checking') }, 4);
      });

      act(() => {
        stream.emit('turn.status', { turnId: 't1', text: 'Checking the outline', category: 'checking' }, 2);
        stream.emit('message.delta', { turnId: 't1', messageId: 'm1', text: 'Here is the quiz' }, 3);
        stream.emit('build.updated', { build: build('ready') }, 4);
        stream.emit('build.updated', { build: build('failed') }, 1);
      });

      expect(lineTexts(hook.result.current)).toEqual(['Starting your build', 'Checking the outline']);
      expect(hook.result.current.streamingMessages).toEqual([{ id: 'm1', turnId: 't1', text: 'Here is the quiz' }]);
      expect(hook.result.current.builds).toEqual([build('checking')]);
      expect(sessionStorage.getItem('progress-p1-last-seq')).toBe('4');
    });

    it('ignores events at or below a sequence saved before the hook mounted', () => {
      sessionStorage.setItem('progress-p1-last-seq', '5');
      const hook = renderHook(() => useProjectEvents('p1'));
      const stream = Stream.instances[0]!;
      expect(stream.url).toBe('/api/projects/p1/events?after=5');

      act(() => {
        stream.open();
        stream.emit('turn.started', { turnId: 't1', startedAt: 1000 }, 5);
      });
      expect(hook.result.current.statusLines).toEqual([]);

      act(() => stream.emit('turn.started', { turnId: 't2', startedAt: 2000 }, 6));
      expect(lineTexts(hook.result.current)).toEqual(['Starting your build']);
    });
  });

  describe('reconnect', () => {
    it('shows reconnecting on a stream error and connected again on reopen, without duplicating replayed lines', () => {
      vi.useFakeTimers();
      const hook = renderHook(() => useProjectEvents('p1'));
      const stream = Stream.instances[0]!;
      act(() => {
        stream.open();
        stream.emit('turn.started', { turnId: 't1', startedAt: 1000 }, 1);
        stream.emit('tool.started', { turnId: 't1', callId: 'c1', name: 'Write', summary: 'Writing the quiz', category: 'writing' }, 2);
      });
      expect(hook.result.current.connection).toBe('connected');

      act(() => stream.drop());
      expect(hook.result.current.connection).toBe('reconnecting');

      act(() => {
        vi.advanceTimersByTime(5_000);
        stream.open();
      });
      expect(hook.result.current.connection).toBe('connected');

      act(() => {
        stream.emit('turn.started', { turnId: 't1', startedAt: 1000 }, 1);
        stream.emit('tool.started', { turnId: 't1', callId: 'c1', name: 'Write', summary: 'Writing the quiz', category: 'writing' }, 2);
        stream.emit('turn.status', { turnId: 't1', text: 'Checking the quiz', category: 'checking' }, 3);
      });
      expect(lineTexts(hook.result.current)).toEqual(['Starting your build', 'Writing the quiz', 'Checking the quiz']);
      expect(Stream.instances).toHaveLength(1);
      expect(stream.close).not.toHaveBeenCalled();
    });

    it('shows lost immediately when the stream closes permanently', () => {
      vi.useFakeTimers();
      const hook = renderHook(() => useProjectEvents('p1'));
      const stream = Stream.instances[0]!;
      act(() => stream.open());

      act(() => stream.closePermanently());
      expect(hook.result.current.connection).toBe('lost');
      expect(stream.close).toHaveBeenCalledOnce();

      act(() => vi.advanceTimersByTime(30_000));
      expect(hook.result.current.connection).toBe('lost');
      expect(stream.close).toHaveBeenCalledOnce();
    });
  });

  describe('switching projects', () => {
    it("closes the old stream, opens one for the new project and shows that project's saved state", () => {
      const saved: ProjectEventState = {
        ...initialProjectEventState,
        turn: { id: 't9', startedAt: 9000, currentStep: 'Packaging the build', status: 'running' },
        statusLines: [{ seq: 7, text: 'Packaging the build', category: 'building' }],
      };
      sessionStorage.setItem('progress-p2-event-state', JSON.stringify(saved));
      sessionStorage.setItem('progress-p2-last-seq', '7');
      const hook = renderHook(({ projectId }) => useProjectEvents(projectId), { initialProps: { projectId: 'p1' } });
      const first = Stream.instances[0]!;
      act(() => {
        first.open();
        first.emit('turn.started', { turnId: 't1', startedAt: 1000 }, 1);
      });

      hook.rerender({ projectId: 'p2' });

      expect(first.close).toHaveBeenCalledOnce();
      expect(Stream.instances).toHaveLength(2);
      expect(Stream.instances[1]!.url).toBe('/api/projects/p2/events?after=7');
      expect(hook.result.current.connection).toBe('reconnecting');
      expect(eventStateOf(hook.result.current)).toEqual(saved);
      expect(JSON.parse(sessionStorage.getItem('progress-p2-event-state')!)).toEqual(saved);
      expect(lineTexts(JSON.parse(sessionStorage.getItem('progress-p1-event-state')!))).toEqual(['Starting your build']);
    });

    it('shows the empty state when the new project has no saved state', () => {
      const hook = renderHook(({ projectId }) => useProjectEvents(projectId), { initialProps: { projectId: 'p1' } });
      act(() => {
        Stream.instances[0]!.open();
        Stream.instances[0]!.emit('turn.started', { turnId: 't1', startedAt: 1000 }, 1);
        Stream.instances[0]!.emit('build.created', { build: build('checking') }, 2);
      });

      hook.rerender({ projectId: 'p2' });

      expect(Stream.instances[0]!.close).toHaveBeenCalledOnce();
      expect(Stream.instances[1]!.url).toBe('/api/projects/p2/events');
      expect(eventStateOf(hook.result.current)).toEqual(initialProjectEventState);
    });
  });

  describe('saved state', () => {
    it('falls back to the empty state when the saved state on mount is unreadable', () => {
      sessionStorage.setItem('progress-p1-event-state', '{"turn":');
      const hook = renderHook(() => useProjectEvents('p1'));
      expect(eventStateOf(hook.result.current)).toEqual(initialProjectEventState);

      act(() => {
        Stream.instances[0]!.open();
        Stream.instances[0]!.emit('turn.started', { turnId: 't1', startedAt: 1000 }, 1);
      });
      expect(lineTexts(hook.result.current)).toEqual(['Starting your build']);
    });

    it('falls back to the empty state when the switched-to project has unreadable saved state', () => {
      sessionStorage.setItem('progress-p2-event-state', 'not json');
      const hook = renderHook(({ projectId }) => useProjectEvents(projectId), { initialProps: { projectId: 'p1' } });
      act(() => {
        Stream.instances[0]!.open();
        Stream.instances[0]!.emit('turn.started', { turnId: 't1', startedAt: 1000 }, 1);
      });

      hook.rerender({ projectId: 'p2' });

      expect(eventStateOf(hook.result.current)).toEqual(initialProjectEventState);
    });
  });

  describe('chat events', () => {
    it("keeps each turn's agent reply in the thread in order and starts a follow-up turn with a new reply", () => {
      const hook = renderHook(() => useProjectEvents('p1'));
      const stream = Stream.instances[0]!;
      act(() => {
        stream.open();
        hook.result.current.addMessage(chatMessage('u1', 1, 'instructor', 't1', 'Make a quiz on cells'));
      });
      act(() => {
        stream.emit('turn.started', { turnId: 't1', startedAt: 1000 }, 1);
        stream.emit('message.delta', { turnId: 't1', messageId: 'a1', text: 'Here is ' }, 2);
        stream.emit('message.delta', { turnId: 't1', messageId: 'a1', text: 'your quiz' }, 3);
        stream.emit('message.completed', { message: chatMessage('a1', 2, 'agent', 't1', 'Here is your quiz') }, 4);
        stream.emit('turn.completed', { turnId: 't1' }, 5);
      });
      act(() => hook.result.current.addMessage(chatMessage('u2', 3, 'instructor', 't2', 'Make it shorter')));

      act(() => stream.emit('turn.started', { turnId: 't2', startedAt: 2000 }, 6));
      expect(hook.result.current.streamingMessages).toEqual([]);
      expect(hook.result.current.messages.map(message => message.id)).toEqual(['u1', 'a1', 'u2']);

      act(() => stream.emit('message.delta', { turnId: 't2', messageId: 'a2', text: 'Here is a shorter quiz' }, 7));
      expect(hook.result.current.streamingMessages).toEqual([{ id: 'a2', turnId: 't2', text: 'Here is a shorter quiz' }]);

      act(() => {
        stream.emit('message.completed', { message: chatMessage('a2', 4, 'agent', 't2', 'Here is a shorter quiz') }, 8);
        stream.emit('turn.completed', { turnId: 't2' }, 9);
      });
      expect(hook.result.current.messages.map(message => message.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
      expect(hook.result.current.messages[1]!.content).toEqual([{ type: 'text', text: 'Here is your quiz' }]);
      expect(hook.result.current.streamingMessages).toEqual([]);
      expect(hook.result.current.outcomes).toEqual({ t1: { status: 'completed' }, t2: { status: 'completed' } });
    });
  });
});