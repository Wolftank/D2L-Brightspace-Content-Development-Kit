import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDriver, AgentSession, SessionRequest } from '../agent/AgentDriver.js';
import type { Project } from '../db/schema.js';
import { NotFound, WorkspaceMissing } from '../errors.js';
import { createSessionService, SESSION_IDLE_MS, type SessionService } from './sessions.js';

type FakeSession = AgentSession & { sessionId: string | null; close: ReturnType<typeof vi.fn> };

function workspaceDirOf(projectId: string): string {
  return resolve('data', 'projects', projectId, 'workspace');
}

describe('session service', () => {
  let projectRows: Map<string, Project>;
  let provisioned: Set<string>;
  let opened: SessionRequest[];
  let sessions: FakeSession[];
  let driver: Pick<AgentDriver, 'open'> & { open: ReturnType<typeof vi.fn> };
  let service: SessionService;

  function addProject(id: string, sessionId: string | null = null): void {
    projectRows.set(id, {
      id,
      ownerId: 'owner-1',
      title: `Project ${id}`,
      avenue: 'scorm',
      sessionId,
      createdAt: 0,
      updatedAt: 0,
    });
    provisioned.add(id);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    projectRows = new Map();
    provisioned = new Set();
    opened = [];
    sessions = [];

    driver = {
      open: vi.fn(async (req: SessionRequest) => {
        opened.push(req);
        const session: FakeSession = { sessionId: null, send: vi.fn(), close: vi.fn(async () => {}) };
        sessions.push(session);
        return session;
      }),
    };

    service = createSessionService({
      projects: {
        getById: (id) => projectRows.get(id),
        setSessionId: (id, sessionId) => {
          const project = projectRows.get(id);
          if (project) projectRows.set(id, { ...project, sessionId });
        },
      },
      workspaces: {
        locate: async (id) => {
          if (!provisioned.has(id)) throw new WorkspaceMissing(`No workspace for ${id}`);
          return workspaceDirOf(id);
        },
      },
      driver,
    });

    addProject('p1');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens a new session in the project workspace with its skills and instructions, and no tools or shell rules', async () => {
    await service.acquire('p1');

    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      workspaceDir: workspaceDirOf('p1'),
      sessionId: null,
      skillsDir: join(workspaceDirOf('p1'), 'kit', 'skills'),
      tools: { name: 'cdk', tools: [] },
      allowedTools: [],
    });
    expect(opened[0]?.instructions).toContain('Project p1');
  });

  it('reopens the agent session stored on the project', async () => {
    addProject('p2', 'stored-session');

    await service.acquire('p2');

    expect(opened[0]?.sessionId).toBe('stored-session');
  });

  it('keeps the session open between turns and saves the agent session id', async () => {
    const first = await service.acquire('p1');
    sessions[0]!.sessionId = 'agent-session-1';
    service.release('p1');

    const second = await service.acquire('p1');

    expect(second).toBe(first);
    expect(driver.open).toHaveBeenCalledTimes(1);
    expect(projectRows.get('p1')?.sessionId).toBe('agent-session-1');
  });

  it('closes an idle session and reopens it by session id on the next turn', async () => {
    await service.acquire('p1');
    sessions[0]!.sessionId = 'agent-session-1';
    service.release('p1');

    await vi.advanceTimersByTimeAsync(SESSION_IDLE_MS);
    await service.acquire('p1');

    expect(sessions[0]?.close).toHaveBeenCalledTimes(1);
    expect(opened).toHaveLength(2);
    expect(opened[1]?.sessionId).toBe('agent-session-1');
  });

  it('keeps a session that is acquired again before the idle period ends', async () => {
    await service.acquire('p1');
    service.release('p1');

    await vi.advanceTimersByTimeAsync(SESSION_IDLE_MS - 1);
    await service.acquire('p1');
    await vi.advanceTimersByTimeAsync(SESSION_IDLE_MS);

    expect(sessions[0]?.close).not.toHaveBeenCalled();
  });

  it('closes the session right away on close, saving its session id', async () => {
    await service.acquire('p1');
    sessions[0]!.sessionId = 'agent-session-1';

    await service.close('p1');
    await service.acquire('p1');

    expect(sessions[0]?.close).toHaveBeenCalledTimes(1);
    expect(projectRows.get('p1')?.sessionId).toBe('agent-session-1');
    expect(opened).toHaveLength(2);
  });

  it('rejects another acquire while the session is opening or busy', async () => {
    const first = service.acquire('p1');
    await expect(service.acquire('p1')).rejects.toThrow('busy');
    await first;

    await expect(service.acquire('p1')).rejects.toThrow('busy');
    expect(driver.open).toHaveBeenCalledTimes(1);
  });

  it('fails with WorkspaceMissing before opening the driver when the workspace is gone', async () => {
    provisioned.delete('p1');

    await expect(service.acquire('p1')).rejects.toBeInstanceOf(WorkspaceMissing);
    expect(driver.open).not.toHaveBeenCalled();
  });

  it('fails with NotFound for an unknown project', async () => {
    await expect(service.acquire('missing')).rejects.toBeInstanceOf(NotFound);
    expect(driver.open).not.toHaveBeenCalled();
  });

  it('lets a later acquire retry after the driver fails to open', async () => {
    driver.open.mockRejectedValueOnce(new Error('agent failed to start'));

    await expect(service.acquire('p1')).rejects.toThrow('agent failed to start');
    await service.acquire('p1');

    expect(driver.open).toHaveBeenCalledTimes(2);
  });

  it('keeps each project in its own workspace and session', async () => {
    addProject('p2');
    await service.acquire('p1');
    await service.acquire('p2');

    await service.close('p1');

    expect(opened.map((req) => req.workspaceDir)).toEqual([workspaceDirOf('p1'), workspaceDirOf('p2')]);
    expect(sessions[0]?.close).toHaveBeenCalledTimes(1);
    expect(sessions[1]?.close).not.toHaveBeenCalled();
  });

  it('recovers from an idle close that fails and reopens on the next acquire', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await service.acquire('p1');
    sessions[0]!.close.mockRejectedValueOnce(new Error('close failed'));
    service.release('p1');

    await vi.advanceTimersByTimeAsync(SESSION_IDLE_MS);
    await service.acquire('p1');

    expect(driver.open).toHaveBeenCalledTimes(2);
  });
});
