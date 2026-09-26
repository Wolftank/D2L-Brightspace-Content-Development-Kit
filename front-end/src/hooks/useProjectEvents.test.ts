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
        turnId: 'turn-1',
      },
    });

    expect(result.turn).toEqual({
      id: 'turn-1',
      status: 'running',
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
      },
    });

    expect(result.statusLines.at(-1)).toEqual({
      seq: 2,
      text: 'Running quality checks',
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

    expect(second.replyText).toBe('Hello world');
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

    expect(result).toEqual(initialProjectEventState);
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
      },
    });

    expect(result.statusLines.at(-1)).toEqual({
      seq: 6,
      text: 'Generating activity',
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
      },
    });

    expect(result.statusLines.at(-1)).toEqual({
      seq: 7,
      text: 'Activity generated',
    });
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
        },
      },
    });

    expect(result.turn).toEqual({
      id: 'turn-1',
      status: 'failed',
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
    });

    expect(result.statusLines.at(-1)).toEqual({
      seq: 15,
      text: 'Build cancelled',
    });
  });
});