import { randomUUID } from 'node:crypto';
import { eq, max } from 'drizzle-orm';
import type { Db } from './index.js';
import { builds, type Build } from './schema.js';

export interface CreateBuildInput {
  projectId: string;
  version: number;
  avenue: Build['avenue'];
  turnId?: string | null;
}

export interface FinishBuildInput {
  status: 'ready' | 'failed';
  qa: Build['qa'];
  error: Build['error'];
}

export interface BuildsRepo {
  /** One more than the project's highest build version, starting at 1. */
  nextVersion(projectId: string): number;
  /** Inserts a build with status `checking`. */
  create(input: CreateBuildInput): Build;
  get(id: string): Build | undefined;
  /** Stores a build's final status, QA gate report, and error, returning the updated row. */
  finish(id: string, input: FinishBuildInput): Build;
}

export function createBuildsRepo(db: Db): BuildsRepo {
  return {
    nextVersion(projectId) {
      const row = db
        .select({ latest: max(builds.version) })
        .from(builds)
        .where(eq(builds.projectId, projectId))
        .get();
      return (row?.latest ?? 0) + 1;
    },
    create({ projectId, version, avenue, turnId }) {
      const build: Build = {
        id: randomUUID(),
        projectId,
        version,
        status: 'checking',
        avenue,
        qa: null,
        error: null,
        turnId: turnId ?? null,
        createdAt: Date.now(),
      };
      db.insert(builds).values(build).run();
      return build;
    },
    get(id) {
      return db.select().from(builds).where(eq(builds.id, id)).get();
    },
    finish(id, { status, qa, error }) {
      return db.update(builds).set({ status, qa, error }).where(eq(builds.id, id)).returning().get()!;
    },
  };
}
