import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from './index.js';
import { createProjectsRepo, type ProjectsRepo } from './projects.js';
import { testDb } from './test-db.js';
import { createUsersRepo } from './users.js';

describe('projects repo', () => {
  let db: Db;
  let projects: ProjectsRepo;
  let ownerId: string;

  beforeEach(() => {
    db = testDb();
    projects = createProjectsRepo(db);
    ownerId = createUsersRepo(db).ensureLocalUser().id;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a project under the given id, owned by the given user', () => {
    const project = projects.create({ id: 'project-1', ownerId, title: 'Cell division practice' });
    expect(project.id).toBe('project-1');
    expect(project.ownerId).toBe(ownerId);
    expect(project.avenue).toBeNull();
    expect(project.sessionId).toBeNull();
  });

  it('gets a project scoped to its owner', () => {
    const project = projects.create({ id: 'project-1', ownerId, title: 'Cell division practice' });
    expect(projects.get(ownerId, project.id)).toEqual(project);
  });

  it('does not return a project for a different owner', () => {
    const project = projects.create({ id: 'project-1', ownerId, title: 'Cell division practice' });
    expect(projects.get('someone-else', project.id)).toBeUndefined();
  });

  it('gets a project by id regardless of owner, and undefined for an unknown id', () => {
    const project = projects.create({ id: 'project-1', ownerId, title: 'Cell division practice' });
    expect(projects.getById(project.id)).toEqual(project);
    expect(projects.getById('missing')).toBeUndefined();
  });

  it('sets the session id', () => {
    const project = projects.create({ id: 'project-1', ownerId, title: 'Cell division practice' });
    projects.setSessionId(project.id, 'session-123');
    expect(projects.get(ownerId, project.id)?.sessionId).toBe('session-123');
  });

  it('stores the avenue when one is given (F9)', () => {
    const project = projects.create({ id: 'project-1', ownerId, title: 'Cell division practice', avenue: 'scorm' });
    expect(project.avenue).toBe('scorm');
    expect(projects.get(ownerId, project.id)?.avenue).toBe('scorm');
  });

  it('returns undefined for a project id that does not exist (F12)', () => {
    expect(projects.get(ownerId, 'no-such-project')).toBeUndefined();
  });

  it('changes updatedAt when the session id is set (F13)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-01T12:00:00Z'));
    const project = projects.create({ id: 'project-1', ownerId, title: 'Cell division practice' });

    vi.setSystemTime(new Date('2026-09-01T12:00:05Z'));
    projects.setSessionId(project.id, 'session-123');

    const updated = projects.get(ownerId, project.id);
    expect(updated?.sessionId).toBe('session-123');
    expect(updated?.updatedAt).toBe(new Date('2026-09-01T12:00:05Z').getTime());
    expect(updated?.createdAt).toBe(project.createdAt);
  });

  it('never returns a project for any other owner id (NF9)', () => {
    const project = projects.create({ id: 'project-1', ownerId, title: 'Cell division practice' });
    const otherOwners = [
      '',
      'someone-else',
      ownerId.toUpperCase(),
      `${ownerId} `,
      '%',
      "' OR '1'='1",
      ...Array.from({ length: 50 }, () => randomUUID()),
    ].filter((id) => id !== ownerId);

    for (const other of otherOwners) {
      expect(projects.get(other, project.id)).toBeUndefined();
    }
  });
});
