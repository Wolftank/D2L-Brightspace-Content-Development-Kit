import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import { eq } from 'drizzle-orm';
import type { Db } from './index.js';
import { users, type User } from './schema.js';

export interface UsersRepo {
  /** Returns the single local-mode user, inserting it on first use. */
  ensureLocalUser(): User;
  get(id: string): User | undefined;
}

export function createUsersRepo(db: Db): UsersRepo {
  return {
    ensureLocalUser() {
      const existing = db.select().from(users).limit(1).all()[0];
      if (existing) return existing;

      const user: User = {
        id: randomUUID(),
        displayName: userInfo().username,
        email: null,
        role: 'instructor',
      };
      db.insert(users).values(user).run();
      return user;
    },
    get(id) {
      return db.select().from(users).where(eq(users.id, id)).all()[0];
    },
  };
}
