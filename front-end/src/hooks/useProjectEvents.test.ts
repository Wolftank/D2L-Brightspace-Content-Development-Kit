import { describe, expect, it } from 'vitest';
import {
  initialProjectEventState,
  projectEventReducer,
} from './useProjectEvents';

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
      text: 'Build cancelled',
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
