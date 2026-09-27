import { randomUUID } from 'node:crypto';
import type { BuildsRepo } from '../db/builds.js';
import type { ProjectsRepo } from '../db/projects.js';
import type { Build, Project, Turn } from '../db/schema.js';
import type { TurnsRepo } from '../db/turns.js';
import { NotFound } from '../errors.js';
import type { WorkspaceService } from './workspaces.js';

/** A project as the API sends it: the stored row plus `targetCourse`, which is null until course selection exists. */
export type ApiProject = Project & { targetCourse: null };

export type BuildSummary = Pick<Build, 'id' | 'version' | 'status' | 'createdAt'>;

export interface ProjectDetails {
  project: ApiProject;
  /** Oldest version first. */
  builds: BuildSummary[];
  /** Present only while the project has a `queued` or `running` turn. */
  activeTurn?: Turn;
}

export interface CreateProjectInput {
  title: string;
  avenue: 'scorm';
}

export interface ProjectServiceDeps {
  projects: Pick<ProjectsRepo, 'create' | 'get'>;
  workspaces: Pick<WorkspaceService, 'create' | 'remove'>;
  builds: Pick<BuildsRepo, 'listByProject'>;
  turns: Pick<TurnsRepo, 'findActive'>;
}

export interface ProjectService {
  /**
   * Provisions the project's workspace, then stores the project, so a stored
   * project always has a complete workspace. On failure the workspace is
   * removed and the error rethrown.
   */
  create(ownerId: string, input: CreateProjectInput): Promise<ApiProject>;
  /** The project with its build summaries and active turn, if it is `ownerId`'s; otherwise throws `NotFound`. */
  get(ownerId: string, id: string): ProjectDetails;
}

export function createProjectService(deps: ProjectServiceDeps): ProjectService {
  return {
    async create(ownerId, { title, avenue }) {
      const id = randomUUID();
      try {
        await deps.workspaces.create(id);
        return toApi(deps.projects.create({ id, ownerId, title, avenue }));
      } catch (err) {
        await deps.workspaces.remove(id).catch((removeErr: unknown) => {
          console.error(`Failed to remove the workspace of project ${id} after its setup failed:`, removeErr);
        });
        throw err;
      }
    },

    get(ownerId, id) {
      const project = deps.projects.get(ownerId, id);
      if (!project) throw new NotFound();
      const activeTurn = deps.turns.findActive(id);
      return {
        project: toApi(project),
        builds: deps.builds.listByProject(id).map(({ id, version, status, createdAt }) => ({ id, version, status, createdAt })),
        ...(activeTurn ? { activeTurn } : {}),
      };
    },
  };
}

function toApi(project: Project): ApiProject {
  return { ...project, targetCourse: null };
}
