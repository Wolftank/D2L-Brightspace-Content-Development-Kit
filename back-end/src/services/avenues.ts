import type { Project as ApiProject, BuildableAvenue } from '@cdk/contract';
import type { ProjectsRepo } from '../db/projects.js';
import type { TurnsRepo } from '../db/turns.js';
import { AvenueChanging, NotFound, TurnActive } from '../errors.js';
import { log } from '../log.js';
import type { EventService } from '../pipeline/events.js';
import { toApi } from './projects.js';
import type { WorkspaceService } from './workspaces.js';

export interface AvenueServiceDeps {
  projects: Pick<ProjectsRepo, 'get' | 'getById' | 'setAvenue'>;
  workspaces: Pick<WorkspaceService, 'startOutput'>;
  turns: Pick<TurnsRepo, 'findActive'>;
  events: Pick<EventService, 'append'>;
}

/** Sets a project's avenue, when the agent picks it and when the instructor changes it. */
export interface AvenueService {
  /**
   * Replaces the project's output with the avenue's starter, stores the
   * avenue, and emits `project.updated`. A project that already has the avenue
   * is returned as it is. Unscoped, for the agent's `set_format` tool. Throws
   * `NotFound` for an unknown project.
   */
  set(projectId: string, avenue: BuildableAvenue): Promise<ApiProject>;

  /**
   * `set` on `ownerId`'s project, between its turns. Throws `NotFound` for an
   * unknown or another owner's project, `TurnActive` while the project has a
   * `queued` or `running` turn, and `AvenueChanging` while an earlier call
   * for the project is still at work.
   */
  setForOwner(ownerId: string, projectId: string, avenue: BuildableAvenue): Promise<ApiProject>;

  /** Whether a `setForOwner` call for the project is still at work. No turn may start until it ends. */
  changing(projectId: string): boolean;
}

export function createAvenueService(deps: AvenueServiceDeps): AvenueService {
  const changing = new Set<string>();

  async function set(projectId: string, avenue: BuildableAvenue): Promise<ApiProject> {
    const project = deps.projects.getById(projectId);
    if (!project) throw new NotFound();
    if (project.avenue === avenue) return toApi(project);

    await deps.workspaces.startOutput(projectId, avenue);
    const updated = deps.projects.setAvenue(projectId, avenue);
    if (!updated) throw new NotFound();
    log.info({ projectId, avenue, previousAvenue: project.avenue }, 'Project avenue set');
    deps.events.append({ projectId, kind: 'project.updated', payload: { project: toApi(updated) } });
    return toApi(updated);
  }

  return {
    set,

    async setForOwner(ownerId, projectId, avenue) {
      if (!deps.projects.get(ownerId, projectId)) throw new NotFound();
      const active = deps.turns.findActive(projectId);
      if (active) throw new TurnActive(active.id);
      if (changing.has(projectId)) throw new AvenueChanging();
      // Claimed in the same step as the checks, so a message arriving while `set` waits on the disk is refused.
      changing.add(projectId);
      try {
        return await set(projectId, avenue);
      } finally {
        changing.delete(projectId);
      }
    },

    changing: (projectId) => changing.has(projectId),
  };
}
