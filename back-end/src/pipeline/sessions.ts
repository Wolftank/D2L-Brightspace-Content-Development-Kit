import { join } from 'node:path';
import type { AgentDriver, AgentSession } from '../agent/AgentDriver.js';
import { renderProjectInstructions } from '../agent/instructions.js';
import type { ProjectsRepo } from '../db/projects.js';
import { NotFound } from '../errors.js';
import type { WorkspaceService } from '../services/workspaces.js';

/** How long a session stays open after its last turn before the service closes it. */
export const SESSION_IDLE_MS = 15 * 60 * 1000;

const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';

export interface SessionServiceDeps {
  projects: Pick<ProjectsRepo, 'getById' | 'setSessionId'>;
  workspaces: Pick<WorkspaceService, 'locate'>;
  driver: Pick<AgentDriver, 'open'>;
}

/**
 * Hands the runner one open session per project and owns its lifetime, as
 * docs/architecture.md's "Sessions" section describes. A session stays open
 * between turns and closes once it has been idle for `SESSION_IDLE_MS`.
 */
export interface SessionService {
  /**
   * Returns the project's open session, or opens one in its workspace with the
   * Project's stored session id. The session is busy until `release` or
   * `close`; another `acquire` for the project rejects until then.
   *
   * @throws NotFound when the project does not exist.
   * @throws WorkspaceMissing when the project's workspace is not provisioned, before a session is opened.
   */
  acquire(projectId: string): Promise<AgentSession>;

  /** Ends a turn's use of the session: starts the idle timer and saves the agent's session id on the Project. */
  release(projectId: string): void;

  /**
   * Saves the agent's session id and closes the project's open session now.
   * For a turn whose agent process failed, and for a deleted project.
   */
  close(projectId: string): Promise<void>;
}

interface OpenSession {
  session: AgentSession;
  savedSessionId: string | null;
  idleTimer?: ReturnType<typeof setTimeout>;
}

export function createSessionService(deps: SessionServiceDeps): SessionService {
  const openSessions = new Map<string, OpenSession>();
  const busy = new Set<string>();

  async function openSession(projectId: string): Promise<OpenSession> {
    const project = deps.projects.getById(projectId);
    if (!project) throw new NotFound('Project not found');

    const workspaceDir = await deps.workspaces.locate(projectId);
    const session = await deps.driver.open({
      workspaceDir,
      sessionId: project.sessionId,
      instructions: renderProjectInstructions({ project, workspaceDir, shell: SHELL }),
      skillsDir: join(workspaceDir, 'kit', 'skills'),
      tools: { name: 'cdk', tools: [] },
      allowedTools: [],
    });
    return { session, savedSessionId: project.sessionId };
  }

  function saveSessionId(projectId: string, entry: OpenSession): void {
    const { sessionId } = entry.session;
    if (sessionId !== null && sessionId !== entry.savedSessionId) {
      deps.projects.setSessionId(projectId, sessionId);
      entry.savedSessionId = sessionId;
    }
  }

  async function close(projectId: string): Promise<void> {
    const entry = openSessions.get(projectId);
    if (!entry) return;

    openSessions.delete(projectId);
    busy.delete(projectId);
    clearTimeout(entry.idleTimer);
    try {
      saveSessionId(projectId, entry);
    } finally {
      await entry.session.close();
    }
  }

  function closeIdle(projectId: string): void {
    close(projectId).catch((err: unknown) => {
      console.error(`Failed to close the idle session for project ${projectId}:`, err);
    });
  }

  return {
    async acquire(projectId) {
      if (busy.has(projectId)) {
        throw new Error(`The session for project ${projectId} is busy`);
      }
      busy.add(projectId);

      try {
        const live = openSessions.get(projectId);
        if (live) {
          clearTimeout(live.idleTimer);
          return live.session;
        }
        const entry = await openSession(projectId);
        openSessions.set(projectId, entry);
        return entry.session;
      } catch (err) {
        busy.delete(projectId);
        throw err;
      }
    },

    release(projectId) {
      if (!busy.delete(projectId)) return;
      const entry = openSessions.get(projectId);
      if (!entry) return;

      clearTimeout(entry.idleTimer);
      entry.idleTimer = setTimeout(() => closeIdle(projectId), SESSION_IDLE_MS);
      entry.idleTimer.unref();
      saveSessionId(projectId, entry);
    },

    close,
  };
}
