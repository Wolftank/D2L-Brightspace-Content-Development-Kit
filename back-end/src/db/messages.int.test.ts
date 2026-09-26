import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './index.js';
import { createMessagesRepo, type MessagesRepo } from './messages.js';
import { createProjectsRepo } from './projects.js';
import { testDb } from './test-db.js';
import { createUsersRepo } from './users.js';

describe('messages repo', () => {
  let db: Db;
  let messages: MessagesRepo;
  let projectId: string;
  let otherProjectId: string;

  beforeEach(() => {
    db = testDb();
    messages = createMessagesRepo(db);
    const ownerId = createUsersRepo(db).ensureLocalUser().id;
    const projects = createProjectsRepo(db);
    projectId = projects.create({ id: 'project-1', ownerId, title: 'Cell division practice' }).id;
    otherProjectId = projects.create({ id: 'project-2', ownerId, title: 'Photosynthesis practice' }).id;
  });

  it('stores a message under the given id and reads it back', () => {
    const content = [{ type: 'text' as const, text: 'Build a self-check on mitosis' }];

    const message = messages.create({ id: 'message-1', projectId, role: 'instructor', content, turnId: 'turn-1' });

    expect(message).toMatchObject({ id: 'message-1', projectId, seq: 1, role: 'instructor', content, turnId: 'turn-1' });
    expect(messages.get('message-1')).toEqual(message);
    expect(messages.get('missing')).toBeUndefined();
  });

  it('numbers messages 1, 2, 3 within each project', () => {
    const create = (id: string, project: string) =>
      messages.create({ id, projectId: project, role: 'agent', content: [], turnId: null }).seq;

    expect([create('a', projectId), create('b', projectId), create('c', otherProjectId), create('d', projectId)]).toEqual([
      1, 2, 1, 3,
    ]);
  });
});
