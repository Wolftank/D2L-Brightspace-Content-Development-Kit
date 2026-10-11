import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './index.js';
import { createMessagesRepo, type MessagesRepo } from './messages.js';
import { createProjectsRepo } from './projects.js';
import { turns } from './schema.js';
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

  it("lists a project's messages after a seq, oldest first, each with the turn it started", () => {
    const create = (id: string, project: string, role: 'instructor' | 'agent') =>
      messages.create({ id, projectId: project, role, content: [], turnId: null });
    const first = create('a', projectId, 'instructor');
    const second = create('b', projectId, 'agent');
    create('c', otherProjectId, 'agent');
    const third = create('d', projectId, 'agent');
    db.insert(turns).values({ id: 'turn-1', projectId, messageId: 'a', status: 'running' }).run();

    const listed = messages.listByProject(projectId, { after: 0, limit: 10 });

    expect(listed.map(({ message }) => message)).toEqual([first, second, third]);
    expect(listed.map(({ turn }) => turn?.id ?? null)).toEqual(['turn-1', null, null]);
    expect(messages.listByProject(projectId, { after: 1, limit: 1 }).map(({ message }) => message.id)).toEqual(['b']);
  });
});
