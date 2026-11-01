import { randomUUID } from 'node:crypto';
import type { Project as ApiProject, BuildSummary, ProjectListResponse, ProjectResponse } from '@cdk/contract';
import type { BuildsRepo } from '../db/builds.js';
import type { ProjectsRepo } from '../db/projects.js';
import type { Build, Project } from '../db/schema.js';
import type { TurnsRepo } from '../db/turns.js';
import { NotFound } from '../errors.js';
import { log } from '../log.js';
import type { WorkspaceService } from './workspaces.js';

export interface CreateProjectInput {
  title: string;
  avenue: 'scorm';
}

export interface ProjectServiceDeps {
  projects: Pick<ProjectsRepo, 'create' | 'get' | 'listByOwner'>;
  workspaces: Pick<WorkspaceService, 'create' | 'remove'>;
  builds: Pick<BuildsRepo, 'listByProject' | 'latest'>;
  turns: Pick<TurnsRepo, 'findActive'>;
}

export interface ProjectService {
  /**
   * Provisions the project's workspace, then stores the project, so a stored
   * project always has a complete workspace. On failure the workspace is
   * removed and the error rethrown.
   */
  create(ownerId: string, input: CreateProjectInput): Promise<ApiProject>;
  /** The project with its build summaries (oldest first) and active turn, if it is `ownerId`'s; otherwise throws `NotFound`. */
  get(ownerId: string, id: string): ProjectResponse;
  /** `ownerId`'s projects, most recently used first, each with its latest build. */
  list(ownerId: string): ProjectListResponse;
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
          log.error({ projectId: id, err: removeErr }, 'Failed to remove the workspace after project setup failed');
        });
        throw err;
      }
    },

    get(ownerId, id) {
      const project = deps.projects.get(ownerId, id);
      if (!project) throw new NotFound();
      return {
        project: toApi(project),
        builds: deps.builds.listByProject(id).map(toSummary),
        activeTurn: deps.turns.findActive(id),
      } satisfies ProjectResponse;
    },

    list(ownerId) {
      return {
        items: deps.projects.listByOwner(ownerId).map((project) => {
          const latest = deps.builds.latest(project.id);
          return { project: toApi(project), latestBuild: latest ? toSummary(latest) : null };
        }),
      };
    },
  };
}

function toSummary({ id, version, status, createdAt }: Build): BuildSummary {
  return { id, version, status, createdAt };
}

function toApi(project: Project): ApiProject {
  return { ...project, targetCourse: null };
}
