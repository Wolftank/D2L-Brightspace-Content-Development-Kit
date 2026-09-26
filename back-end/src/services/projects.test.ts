import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateProjectInput as CreateProjectRow } from '../db/projects.js';
import type { Build, Project, Turn } from '../db/schema.js';
import { NotFound } from '../errors.js';
import { createProjectService, type ProjectServiceDeps } from './projects.js';

function setup() {
  const rows = new Map<string, Project>();
  const steps: string[] = [];
  const deps = {
    projects: {
      create: vi.fn((input: CreateProjectRow): Project => {
        steps.push('row');
        const project = { ...input, avenue: input.avenue ?? null, sessionId: null, createdAt: 1, updatedAt: 1 };
        rows.set(project.id, project);
        return project;
      }),
      get: vi.fn((ownerId: string, id: string) => {
        const project = rows.get(id);
        return project?.ownerId === ownerId ? project : undefined;
      }),
    },
    workspaces: {
      create: vi.fn(async (projectId: string) => {
        steps.push(`workspace ${projectId}`);
      }),
      remove: vi.fn(async () => {}),
    },
    builds: { listByProject: vi.fn((): Build[] => []) },
    turns: { findActive: vi.fn((): Turn | undefined => undefined) },
  } satisfies ProjectServiceDeps;
  return { deps, service: createProjectService(deps), steps };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('project service', () => {
  describe('create', () => {
    it('provisions the workspace before storing the project, under the same id', async () => {
      const { service, steps } = setup();

      const project = await service.create('owner-1', { title: 'Cell division practice', avenue: 'scorm' });

      expect(steps).toEqual([`workspace ${project.id}`, 'row']);
      expect(project).toMatchObject({ ownerId: 'owner-1', title: 'Cell division practice', avenue: 'scorm', targetCourse: null });
    });

    it('stores nothing and removes the workspace when provisioning fails', async () => {
      const { deps, service } = setup();
      deps.workspaces.create.mockRejectedValue(new Error('ENOSPC'));

      await expect(service.create('owner-1', { title: 'T', avenue: 'scorm' })).rejects.toThrow('ENOSPC');

      expect(deps.projects.create).not.toHaveBeenCalled();
      expect(deps.workspaces.remove).toHaveBeenCalledWith(deps.workspaces.create.mock.calls[0]![0]);
    });

    it('removes the workspace when storing the project fails', async () => {
      const { deps, service } = setup();
      deps.projects.create.mockImplementation(() => {
        throw new Error('database is locked');
      });

      await expect(service.create('owner-1', { title: 'T', avenue: 'scorm' })).rejects.toThrow('database is locked');

      expect(deps.workspaces.remove).toHaveBeenCalledOnce();
    });

    it('rethrows the setup error when removing the workspace also fails', async () => {
      const { deps, service } = setup();
      deps.workspaces.create.mockRejectedValue(new Error('ENOSPC'));
      deps.workspaces.remove.mockRejectedValue(new Error('EBUSY'));

      await expect(service.create('owner-1', { title: 'T', avenue: 'scorm' })).rejects.toThrow('ENOSPC');
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('returns the project with build summaries, and no active turn when there is none', async () => {
      const { deps, service } = setup();
      const project = await service.create('owner-1', { title: 'T', avenue: 'scorm' });
      deps.builds.listByProject.mockReturnValue([
        { id: 'build-1', version: 1, status: 'failed', createdAt: 5, qa: null, error: null } as Build,
        { id: 'build-2', version: 2, status: 'ready', createdAt: 6, qa: null, error: null } as Build,
      ]);

      const details = service.get('owner-1', project.id);

      expect(details).toEqual({
        project,
        builds: [
          { id: 'build-1', version: 1, status: 'failed', createdAt: 5 },
          { id: 'build-2', version: 2, status: 'ready', createdAt: 6 },
        ],
      });
      expect(details).not.toHaveProperty('activeTurn');
    });

    it('includes the active turn when the project has one', async () => {
      const { deps, service } = setup();
      const project = await service.create('owner-1', { title: 'T', avenue: 'scorm' });
      const turn = { id: 'turn-1', status: 'running' } as Turn;
      deps.turns.findActive.mockReturnValue(turn);

      expect(service.get('owner-1', project.id).activeTurn).toBe(turn);
    });

    it("throws NotFound for another owner's project and for an unknown id", async () => {
      const { service } = setup();
      const project = await service.create('owner-1', { title: 'T', avenue: 'scorm' });

      expect(() => service.get('owner-2', project.id)).toThrow(NotFound);
      expect(() => service.get('owner-1', 'missing')).toThrow(NotFound);
    });
  });
});
