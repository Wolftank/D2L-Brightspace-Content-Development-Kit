import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/index.js';
import { createEventsRepo, type EventsRepo } from '../db/events.js';
import { createProjectsRepo } from '../db/projects.js';
import type { Event } from '../db/schema.js';
import { testDb } from '../db/test-db.js';
import { createUsersRepo } from '../db/users.js';
import { createEventService, type EventService } from './events.js';

describe('event service', () => {
  let db: Db;
  let eventsRepo: EventsRepo;
  let service: EventService;
  let projectId: string;
  let otherProjectId: string;

  beforeEach(() => {
    db = testDb();
    eventsRepo = createEventsRepo(db);
    service = createEventService(eventsRepo);
    const ownerId = createUsersRepo(db).ensureLocalUser().id;
    const projects = createProjectsRepo(db);
    projectId = projects.create({ id: 'project-1', ownerId, title: 'Cell division practice' }).id;
    otherProjectId = projects.create({ id: 'project-2', ownerId, title: 'Photosynthesis practice' }).id;
  });

  it('persists the event before notifying subscribers', () => {
    let storedAtNotifyTime: Event[] = [];
    service.subscribe(projectId, () => {
      storedAtNotifyTime = eventsRepo.listAfter(projectId, 0);
    });

    const appended = service.append({ projectId, kind: 'turn.started', payload: { turnId: 't1' } });

    expect(storedAtNotifyTime).toEqual([appended]);
  });

  it('passes the stored, seq-assigned event to the listener', () => {
    let received: Event | undefined;
    service.subscribe(projectId, (event) => {
      received = event;
    });

    const appended = service.append({ projectId, kind: 'turn.started', payload: { turnId: 't1' } });

    expect(received).toEqual(appended);
    expect(received?.seq).toBeGreaterThan(0);
  });

  it('never crosses two different projects event streams', () => {
    const receivedA: Event[] = [];
    const receivedB: Event[] = [];
    service.subscribe(projectId, (event) => receivedA.push(event));
    service.subscribe(otherProjectId, (event) => receivedB.push(event));

    service.append({ projectId, kind: 'turn.started', payload: {} });

    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(0);
  });

  it('stops delivering events once unsubscribed', () => {
    const received: Event[] = [];
    const unsubscribe = service.subscribe(projectId, (event) => received.push(event));

    service.append({ projectId, kind: 'turn.started', payload: {} });
    unsubscribe();
    service.append({ projectId, kind: 'turn.completed', payload: {} });

    expect(received).toHaveLength(1);
  });

  it('after() delegates to the repo, scoped to the project and cursor', () => {
    const first = service.append({ projectId, kind: 'turn.started', payload: {} });
    const second = service.append({ projectId, kind: 'turn.completed', payload: {} });

    expect(service.after(projectId, first.seq)).toEqual([second]);
    expect(service.after(projectId, 0)).toEqual([first, second]);
  });
});
