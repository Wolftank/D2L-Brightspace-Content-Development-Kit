import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Db } from './index.js';
import { projects, type Project } from './schema.js';

export interface CreateProjectInput {
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
  setSessionId(id: string, sessionId: string): void;
}

export function createProjectsRepo(db: Db): ProjectsRepo {
  return {
    create({ ownerId, title, avenue }) {
      const now = Date.now();
      const project: Project = {
        id: randomUUID(),
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
    setSessionId(id, sessionId) {
      db.update(projects)
        .set({ sessionId, updatedAt: Date.now() })
        .where(eq(projects.id, id))
        .run();
    },
  };
}
