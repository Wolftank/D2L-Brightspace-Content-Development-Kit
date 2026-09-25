import { beforeEach, describe, expect, it } from 'vitest';
import { createBuildsRepo, type BuildsRepo } from './builds.js';
import type { Db } from './index.js';
import { createProjectsRepo } from './projects.js';
import { testDb } from './test-db.js';
import { createUsersRepo } from './users.js';

describe('builds repo', () => {
  let db: Db;
  let builds: BuildsRepo;
  let projectId: string;
  let otherProjectId: string;

  beforeEach(() => {
    db = testDb();
    builds = createBuildsRepo(db);
    const ownerId = createUsersRepo(db).ensureLocalUser().id;
    const projects = createProjectsRepo(db);
    projectId = projects.create({ ownerId, title: 'Cell division practice' }).id;
    otherProjectId = projects.create({ ownerId, title: 'Photosynthesis practice' }).id;
  });

  it('starts a project at version 1 and counts up per project', () => {
    expect(builds.nextVersion(projectId)).toBe(1);

    builds.create({ projectId, version: 1, avenue: 'scorm' });
    builds.create({ projectId, version: 2, avenue: 'scorm' });

    expect(builds.nextVersion(projectId)).toBe(3);
    expect(builds.nextVersion(otherProjectId)).toBe(1);
  });

  it('creates a build as checking, with no report or error yet', () => {
    const build = builds.create({ projectId, version: 1, avenue: 'scorm', turnId: 'turn-1' });

    expect(build).toMatchObject({ projectId, version: 1, status: 'checking', qa: null, error: null, turnId: 'turn-1' });
    expect(builds.get(build.id)).toEqual(build);
  });

  it('refuses a second build with the same version in one project', () => {
    builds.create({ projectId, version: 1, avenue: 'scorm' });

    expect(() => builds.create({ projectId, version: 1, avenue: 'scorm' })).toThrow();
  });

  it('stores the final status, report, and error', () => {
    const build = builds.create({ projectId, version: 1, avenue: 'scorm' });
    const qa = {
      passed: false,
      findings: [
        { rule: 'scorm/manifest', severity: 'error' as const, file: 'imsmanifest.xml', line: null, message: 'm', because: 'b' },
      ],
    };

    const finished = builds.finish(build.id, {
      status: 'failed',
      qa,
      error: { code: 'qa_failed', message: 'The QA gate reported 1 error(s)' },
    });

    expect(finished).toMatchObject({ status: 'failed', qa, error: { code: 'qa_failed' } });
    expect(builds.get(build.id)).toEqual(finished);
  });
});
