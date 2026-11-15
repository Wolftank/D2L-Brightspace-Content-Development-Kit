import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from './index.js';
import { files, type File, type NewFile } from './schema.js';

export interface FilesRepo {
  /** Inserts a file with the current time as `createdAt`. */
  create(input: Omit<NewFile, 'createdAt'>): File;
  /** The project's files, oldest first. */
  listByProject(projectId: string): File[];
  /** The project's files among `ids`. An id of another project's file, or of no file, is left out. */
  findInProject(projectId: string, ids: string[]): File[];
}

export function createFilesRepo(db: Db): FilesRepo {
  return {
    create(input) {
      const file: File = { ...input, createdAt: Date.now() };
      db.insert(files).values(file).run();
      return file;
    },
    listByProject(projectId) {
      return db.select().from(files).where(eq(files.projectId, projectId)).orderBy(asc(files.createdAt), asc(files.id)).all();
    },
    findInProject(projectId, ids) {
      if (ids.length === 0) return [];
      return db
        .select()
        .from(files)
        .where(and(eq(files.projectId, projectId), inArray(files.id, ids)))
        .all();
    },
  };
}
