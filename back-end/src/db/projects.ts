import { and, desc, eq } from 'drizzle-orm';
import type { Db } from './index.js';
import { projects, type Project } from './schema.js';

export interface CreateProjectInput {
  id: string;
  ownerId: string;
  title: string;
  avenue?: Project['avenue'];
}

export interface ProjectsRepo {
  create(input: CreateProjectInput): Project;
  /** Scoped to `ownerId`, so hosted mode is a WHERE clause. Routes use this. */
  get(ownerId: string, id: string): Project | undefined;
  /** Unscoped lookup for pipeline code, which acts on a project a route has already authorized. */
  getById(id: string): Project | undefined;
  /** `ownerId`'s projects, most recently used first. */
  listByOwner(ownerId: string): Project[];
  setSessionId(id: string, sessionId: string): void;
  /** Records that the project was used now, by setting its `updatedAt`, which orders the project list. */
  recordActivity(id: string): void;
}

export function createProjectsRepo(db: Db): ProjectsRepo {
  return {
    create({ id, ownerId, title, avenue }) {
      const now = Date.now();
      const project: Project = {
        id,
        ownerId,
        title,
        avenue: avenue ?? null,
        sessionId: null,
        createdAt: now,
        updatedAt: now,
      };
      db.insert(projects).values(project).run();
      return project;
    },
    get(ownerId, id) {
      return db
        .select()
        .from(projects)
        .where(and(eq(projects.id, id), eq(projects.ownerId, ownerId)))
        .all()[0];
    },
    getById(id) {
      return db.select().from(projects).where(eq(projects.id, id)).get();
    },
    listByOwner(ownerId) {
      return db
        .select()
        .from(projects)
        .where(eq(projects.ownerId, ownerId))
        .orderBy(desc(projects.updatedAt), desc(projects.id))
        .all();
    },
    setSessionId(id, sessionId) {
      db.update(projects)
        .set({ sessionId, updatedAt: Date.now() })
        .where(eq(projects.id, id))
        .run();
    },
    recordActivity(id) {
      db.update(projects).set({ updatedAt: Date.now() }).where(eq(projects.id, id)).run();
    },
  };
}
