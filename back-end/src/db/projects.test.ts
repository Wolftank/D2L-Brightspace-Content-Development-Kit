import { beforeEach, describe, expect, it } from 'vitest';
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

  it('creates a project owned by the given user', () => {
    const project = projects.create({ ownerId, title: 'Cell division practice' });
    expect(project.ownerId).toBe(ownerId);
    expect(project.avenue).toBeNull();
    expect(project.sessionId).toBeNull();
  });

  it('gets a project scoped to its owner', () => {
    const project = projects.create({ ownerId, title: 'Cell division practice' });
    expect(projects.get(ownerId, project.id)).toEqual(project);
  });

  it('does not return a project for a different owner', () => {
    const project = projects.create({ ownerId, title: 'Cell division practice' });
    expect(projects.get('someone-else', project.id)).toBeUndefined();
  });

  it('gets a project by id regardless of owner, and undefined for an unknown id', () => {
    const project = projects.create({ ownerId, title: 'Cell division practice' });
    expect(projects.getById(project.id)).toEqual(project);
    expect(projects.getById('missing')).toBeUndefined();
  });

  it('sets the session id', () => {
    const project = projects.create({ ownerId, title: 'Cell division practice' });
    projects.setSessionId(project.id, 'session-123');
    expect(projects.get(ownerId, project.id)?.sessionId).toBe('session-123');
  });
});
