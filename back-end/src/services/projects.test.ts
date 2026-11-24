import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateProjectInput as CreateProjectRow } from '../db/projects.js';
import type { Build, Project, Turn } from '../db/schema.js';
import { NotFound } from '../errors.js';
import { createProjectService, type ProjectServiceDeps } from './projects.js';
import { captureLog } from '../test/log.js';

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
      listByOwner: vi.fn((ownerId: string) => [...rows.values()].filter((project) => project.ownerId === ownerId).reverse()),
      setTitle: vi.fn((id: string, title: string) => {
        const project = rows.get(id);
        if (!project) return undefined;
        const renamed = { ...project, title, updatedAt: project.updatedAt + 1 };
        rows.set(id, renamed);
        return renamed;
      }),
    },
    workspaces: {
      create: vi.fn(async (projectId: string) => {
        steps.push(`workspace ${projectId}`);
      }),
      remove: vi.fn(async () => {}),
    },
    builds: { listByProject: vi.fn((): Build[] => []), latest: vi.fn((_projectId: string): Build | undefined => undefined) },
    turns: { findActive: vi.fn((): Turn | undefined => undefined) },
    events: { append: vi.fn() },
  } satisfies ProjectServiceDeps;
  return { deps, service: createProjectService(deps), steps };
}

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
      const logRecords = captureLog();
      deps.workspaces.create.mockRejectedValue(new Error('ENOSPC'));
      deps.workspaces.remove.mockRejectedValue(new Error('EBUSY'));

      await expect(service.create('owner-1', { title: 'T', avenue: 'scorm' })).rejects.toThrow('ENOSPC');
      expect(logRecords).toContainEqual(expect.objectContaining({ level: 50, err: expect.objectContaining({ message: 'EBUSY' }) }));
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
      expect(details.activeTurn).toBeUndefined();
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

  describe('list', () => {
    it("lists the owner's projects in the repo's order, each with its latest build summary or null", async () => {
      const { deps, service } = setup();
      const older = await service.create('owner-1', { title: 'Older', avenue: 'scorm' });
      const newer = await service.create('owner-1', { title: 'Newer', avenue: 'scorm' });
      await service.create('owner-2', { title: 'Not theirs', avenue: 'scorm' });
      deps.builds.latest.mockImplementation((projectId) =>
        projectId === older.id ? ({ id: 'build-3', version: 3, status: 'ready', createdAt: 7, qa: null, error: null } as Build) : undefined,
      );

      expect(service.list('owner-1')).toEqual({
        items: [
          { project: newer, latestBuild: null },
          { project: older, latestBuild: { id: 'build-3', version: 3, status: 'ready', createdAt: 7 } },
        ],
      });
    });

    it('is empty for an owner with no projects', () => {
      expect(setup().service.list('owner-1')).toEqual({ items: [] });
    });
  });

  describe('rename', () => {
    it('stores the title and sends project.updated with the renamed project', async () => {
      const { deps, service } = setup();
      const project = await service.create('owner-1', { title: 'Cell divison', avenue: 'scorm' });

      const renamed = service.rename('owner-1', project.id, 'Cell division');

      expect(renamed).toMatchObject({ id: project.id, title: 'Cell division', avenue: 'scorm', targetCourse: null });
      expect(deps.projects.setTitle).toHaveBeenCalledWith(project.id, 'Cell division');
      expect(deps.events.append).toHaveBeenCalledWith({ projectId: project.id, kind: 'project.updated', payload: { project: renamed } });
    });

    it('renames while a turn is active, since a turn reads the title when it starts', async () => {
      const { deps, service } = setup();
      const project = await service.create('owner-1', { title: 'T', avenue: 'scorm' });
      deps.turns.findActive.mockReturnValue({ id: 'turn-1', status: 'running' } as Turn);

      expect(service.rename('owner-1', project.id, 'New title').title).toBe('New title');
    });

    it("throws NotFound for another owner's project and for an unknown id, and stores nothing", async () => {
      const { deps, service } = setup();
      const project = await service.create('owner-1', { title: 'T', avenue: 'scorm' });

      expect(() => service.rename('owner-2', project.id, 'Taken over')).toThrow(NotFound);
      expect(() => service.rename('owner-1', 'missing', 'New title')).toThrow(NotFound);
      expect(deps.projects.setTitle).not.toHaveBeenCalled();
      expect(deps.events.append).not.toHaveBeenCalled();
    });
  });
});
