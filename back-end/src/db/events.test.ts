import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './index.js';
import { createEventsRepo, type EventsRepo } from './events.js';
import { createProjectsRepo } from './projects.js';
import { testDb } from './test-db.js';
import { createUsersRepo } from './users.js';

describe('events repo', () => {
  let db: Db;
  let events: EventsRepo;
  let projectId: string;
  let otherProjectId: string;

  beforeEach(() => {
    db = testDb();
    events = createEventsRepo(db);
    const ownerId = createUsersRepo(db).ensureLocalUser().id;
    const projects = createProjectsRepo(db);
    projectId = projects.create({ ownerId, title: 'Cell division practice' }).id;
    otherProjectId = projects.create({ ownerId, title: 'Photosynthesis practice' }).id;
  });

  it('inserts an event and assigns it a seq', () => {
    const event = events.insert({ projectId, kind: 'turn.started', payload: { turnId: 't1' } });
    expect(event.seq).toBeGreaterThan(0);
    expect(event.projectId).toBe(projectId);
    expect(event.kind).toBe('turn.started');
    expect(event.payload).toEqual({ turnId: 't1' });
    expect(event.turnId).toBeNull();
  });

  it('assigns increasing seq values across inserts', () => {
    const first = events.insert({ projectId, kind: 'turn.started', payload: {} });
    const second = events.insert({ projectId, kind: 'turn.completed', payload: {} });
    expect(second.seq).toBeGreaterThan(first.seq);
  });

  it('keeps the given turnId', () => {
    const event = events.insert({ projectId, turnId: 'turn-1', kind: 'turn.started', payload: {} });
    expect(event.turnId).toBe('turn-1');
  });

  it('lists events after a seq, ascending', () => {
    const first = events.insert({ projectId, kind: 'turn.started', payload: {} });
    const second = events.insert({ projectId, kind: 'turn.status', payload: { text: 'working' } });
    const third = events.insert({ projectId, kind: 'turn.completed', payload: {} });

    expect(events.listAfter(projectId, first.seq)).toEqual([second, third]);
    expect(events.listAfter(projectId, 0)).toEqual([first, second, third]);
    expect(events.listAfter(projectId, third.seq)).toEqual([]);
  });

  it('scopes listAfter to the given project', () => {
    events.insert({ projectId, kind: 'turn.started', payload: {} });
    const otherEvent = events.insert({ projectId: otherProjectId, kind: 'turn.started', payload: {} });

    expect(events.listAfter(otherProjectId, 0)).toEqual([otherEvent]);
  });
});
