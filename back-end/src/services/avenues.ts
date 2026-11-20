import type { Project as ApiProject, BuildableAvenue } from '@cdk/contract';
import type { ProjectsRepo } from '../db/projects.js';
import type { TurnsRepo } from '../db/turns.js';
import { NotFound, TurnActive } from '../errors.js';
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
   * unknown or another owner's project, and `TurnActive` while the project
   * has a `queued` or `running` turn.
   */
  setForOwner(ownerId: string, projectId: string, avenue: BuildableAvenue): Promise<ApiProject>;
}

export function createAvenueService(deps: AvenueServiceDeps): AvenueService {
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
      return set(projectId, avenue);
    },
  };
}
