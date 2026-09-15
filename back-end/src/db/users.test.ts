import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './index.js';
import { testDb } from './test-db.js';
import { createUsersRepo, type UsersRepo } from './users.js';

describe('users repo', () => {
  let db: Db;
  let users: UsersRepo;

  beforeEach(() => {
    db = testDb();
    users = createUsersRepo(db);
  });

  it('creates the stub user on first call and returns it thereafter', () => {
    const first = users.ensureLocalUser();
    expect(first.role).toBe('instructor');

    const second = users.ensureLocalUser();
    expect(second).toEqual(first);
  });

  it('gets a user by id', () => {
    const created = users.ensureLocalUser();
    expect(users.get(created.id)).toEqual(created);
  });

  it('returns undefined for an unknown id', () => {
    expect(users.get('missing')).toBeUndefined();
  });
});
