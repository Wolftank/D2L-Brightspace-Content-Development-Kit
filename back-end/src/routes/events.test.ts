import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { createBuildsRepo } from '../db/builds.js';
import { createEventsRepo } from '../db/events.js';
import type { Db } from '../db/index.js';
import { createProjectsRepo, type ProjectsRepo } from '../db/projects.js';
import { users as usersTable, type Project, type User } from '../db/schema.js';
import { testDb } from '../db/test-db.js';
import { createTurnsRepo } from '../db/turns.js';
import { createUsersRepo } from '../db/users.js';
import type { Deps } from '../deps.js';
import { createEventService, type EventService } from '../pipeline/events.js';
import { createProjectService } from '../services/projects.js';

interface Frame {
  seq: number;
  kind: string;
  payload: unknown;
}

function parseFrame(raw: string): Frame {
  const lines = raw.split('\n');
  const idLine = lines.find((l) => l.startsWith('id: '));
  const eventLine = lines.find((l) => l.startsWith('event: '));
  const dataLine = lines.find((l) => l.startsWith('data: '));
  if (!idLine || !eventLine || !dataLine) {
    throw new Error(`malformed SSE frame: ${JSON.stringify(raw)}`);
  }
  return {
    seq: Number(idLine.slice('id: '.length)),
    kind: eventLine.slice('event: '.length),
    payload: JSON.parse(dataLine.slice('data: '.length)),
  };
}

/** Reads SSE frames off `res` as they arrive, skipping keepalive comments. */
class FrameReader {
  private buffer = '';
  private readonly frames: Frame[] = [];
  private waiters: Array<{ count: number; resolve: () => void }> = [];

  constructor(res: http.IncomingMessage) {
    res.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
        const raw = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 2);
        if (raw.startsWith(':')) continue;
        this.frames.push(parseFrame(raw));
        this.checkWaiters();
      }
    });
  }

  private checkWaiters() {
    this.waiters = this.waiters.filter((w) => {
      if (this.frames.length >= w.count) {
        w.resolve();
        return false;
      }
      return true;
    });
  }

  /** Resolves with the first `count` frames received so far, once there are that many. */
  waitFor(count: number, timeoutMs = 2000): Promise<Frame[]> {
    if (this.frames.length >= count) return Promise.resolve(this.frames.slice(0, count));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${count} frame(s)`)), timeoutMs);
      this.waiters.push({
        count,
        resolve: () => {
          clearTimeout(timer);
          resolve(this.frames.slice(0, count));
        },
      });
    });
  }

  all(): Frame[] {
    return [...this.frames];
  }
}

function openSse(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ req: http.ClientRequest; res: http.IncomingMessage; reader: FrameReader }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, headers }, (res) => {
      resolve({ req, res, reader: new FrameReader(res) });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('GET /api/projects/:projectId/events', () => {
  let db: Db;
  let projects: ProjectsRepo;
  let service: EventService;
  let owner: User;
  let project: Project;
  let server: http.Server;
  let port: number;

  function fakeDeps(overrides: Partial<Deps> = {}): Deps {
    return {
      users: { ensureLocalUser: () => owner, get: (id) => (id === owner.id ? owner : undefined) },
      projects: createProjectService({
        projects,
        workspaces: { create: async () => {}, remove: async () => {} },
        builds: createBuildsRepo(db),
        turns: createTurnsRepo(db),
      }),
      builds: {
        get: () => {
          throw new Error('not used by these tests');
        },
        download: async () => {
          throw new Error('not used by these tests');
        },
      },
      events: service,
      driver: { probe: async () => ({ ok: true }) },
      ...overrides,
    };
  }

  beforeEach(() => {
    db = testDb();
    owner = createUsersRepo(db).ensureLocalUser();
    projects = createProjectsRepo(db);
    project = projects.create({ id: 'project-1', ownerId: owner.id, title: 'Cell division practice' });
    service = createEventService(createEventsRepo(db));
  });

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  async function startServer(deps: Deps) {
    const app = createApp(deps);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    port = (server.address() as AddressInfo).port;
  }

  it('returns 404 for a project that does not exist', async () => {
    const app = createApp(fakeDeps());
    const res = await request(app).get('/api/projects/does-not-exist/events');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('returns the same 404 (not a distinguishing error) for a project owned by someone else', async () => {
    const otherUserId = randomUUID();
    db.insert(usersTable)
      .values({ id: otherUserId, displayName: 'Someone Else', email: null, role: 'instructor' })
      .run();
    const othersProject = projects.create({ id: 'project-3', ownerId: otherUserId, title: 'Not yours' });

    const app = createApp(fakeDeps());
    const res = await request(app).get(`/api/projects/${othersProject.id}/events`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('rejects a malformed cursor with the standard validation error envelope', async () => {
    const app = createApp(fakeDeps());
    const res = await request(app)
      .get(`/api/projects/${project.id}/events`)
      .set('Last-Event-ID', 'not-a-number');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it('rejects a negative cursor with the standard validation error envelope', async () => {
    const app = createApp(fakeDeps());
    const res = await request(app).get(`/api/projects/${project.id}/events?after=-1`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it('rejects an empty Last-Event-ID rather than silently falling back to a valid ?after=', async () => {
    const app = createApp(fakeDeps());
    const res = await request(app)
      .get(`/api/projects/${project.id}/events?after=0`)
      .set('Last-Event-ID', '');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it.each([
    ['5.0', 'a decimal'],
    ['1e3', 'exponential notation'],
    ['0x10', 'hex notation'],
    [' 5 ', 'surrounded by whitespace'],
    ['', 'empty'],
  ])('rejects a ?after= cursor that is %s (%s) rather than coercing it', async (value) => {
    // Delivered via the query string, not the Last-Event-ID header: HTTP
    // header values get OWS-trimmed in transit, which would silently turn
    // ' 5 ' into a valid '5' before it ever reached our validation.
    const app = createApp(fakeDeps());
    const res = await request(app).get(`/api/projects/${project.id}/events`).query({ after: value });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it('replays full history from the beginning when no cursor is given, over a proper SSE response', async () => {
    const first = service.append({ projectId: project.id, kind: 'turn.started', payload: { turnId: 't1' } });
    const second = service.append({ projectId: project.id, kind: 'turn.completed', payload: { turnId: 't1' } });

    await startServer(fakeDeps());
    const { reader, req, res } = await openSse(port, `/api/projects/${project.id}/events`);
    const frames = await reader.waitFor(2);

    expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(frames).toEqual([
      { seq: first.seq, kind: 'turn.started', payload: { turnId: 't1' } },
      { seq: second.seq, kind: 'turn.completed', payload: { turnId: 't1' } },
    ]);
    req.destroy();
  });

  it('resumes via Last-Event-ID, replaying only what comes after it', async () => {
    const first = service.append({ projectId: project.id, kind: 'turn.started', payload: {} });
    const second = service.append({ projectId: project.id, kind: 'turn.status', payload: { text: 'go' } });

    await startServer(fakeDeps());
    const { reader, req } = await openSse(port, `/api/projects/${project.id}/events`, {
      'Last-Event-ID': String(first.seq),
    });
    const frames = await reader.waitFor(1);

    expect(frames).toEqual([{ seq: second.seq, kind: 'turn.status', payload: { text: 'go' } }]);
    req.destroy();
  });

  it('resumes via ?after=, replaying only what comes after it', async () => {
    const first = service.append({ projectId: project.id, kind: 'turn.started', payload: {} });
    const second = service.append({ projectId: project.id, kind: 'turn.status', payload: { text: 'go' } });

    await startServer(fakeDeps());
    const { reader, req } = await openSse(port, `/api/projects/${project.id}/events?after=${first.seq}`);
    const frames = await reader.waitFor(1);

    expect(frames).toEqual([{ seq: second.seq, kind: 'turn.status', payload: { text: 'go' } }]);
    req.destroy();
  });

  it('prefers Last-Event-ID over ?after= when both are given', async () => {
    const first = service.append({ projectId: project.id, kind: 'turn.started', payload: {} });
    const second = service.append({ projectId: project.id, kind: 'turn.status', payload: { text: 'go' } });

    await startServer(fakeDeps());
    const { reader, req } = await openSse(port, `/api/projects/${project.id}/events?after=0`, {
      'Last-Event-ID': String(first.seq),
    });
    const frames = await reader.waitFor(1);

    expect(frames).toEqual([{ seq: second.seq, kind: 'turn.status', payload: { text: 'go' } }]);
    req.destroy();
  });

  it('continues seamlessly from replay into live events', async () => {
    const first = service.append({ projectId: project.id, kind: 'turn.started', payload: {} });

    await startServer(fakeDeps());
    const { reader, req } = await openSse(port, `/api/projects/${project.id}/events`);
    await reader.waitFor(1);

    const second = service.append({ projectId: project.id, kind: 'turn.completed', payload: {} });
    const frames = await reader.waitFor(2);

    expect(frames).toEqual([
      { seq: first.seq, kind: 'turn.started', payload: {} },
      { seq: second.seq, kind: 'turn.completed', payload: {} },
    ]);
    req.destroy();
  });

  it('delivers an event appended right as replay finishes exactly once, in order (event only in the live buffer)', async () => {
    const preRace = service.append({ projectId: project.id, kind: 'turn.started', payload: {} });

    let injected = false;
    let raceEvent: ReturnType<typeof service.append> | undefined;
    const racyService: EventService = {
      ...service,
      after(projectId, seq) {
        const list = service.after(projectId, seq);
        if (!injected) {
          injected = true;
          // Simulate a concurrent append landing after history was read for
          // replay, but before the route has switched from replaying to live.
          // At this point the event exists ONLY in the live buffer, not in
          // the `list` already captured above.
          raceEvent = service.append({ projectId, kind: 'turn.completed', payload: {} });
        }
        return list;
      },
    };

    await startServer(fakeDeps({ events: racyService }));
    const { reader, req } = await openSse(port, `/api/projects/${project.id}/events`);
    const frames = await reader.waitFor(2);

    expect(raceEvent).toBeDefined();
    expect(frames).toEqual([
      { seq: preRace.seq, kind: 'turn.started', payload: {} },
      { seq: raceEvent!.seq, kind: 'turn.completed', payload: {} },
    ]);

    // Give any duplicate delivery a chance to arrive, then confirm there isn't one.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(reader.all()).toHaveLength(2);

    req.destroy();
  });

  it('delivers an event appended right as replay finishes exactly once, in order (event in both history and the live buffer)', async () => {
    const preRace = service.append({ projectId: project.id, kind: 'turn.started', payload: {} });

    let injected = false;
    let raceEvent: ReturnType<typeof service.append> | undefined;
    const racyService: EventService = {
      ...service,
      after(projectId, seq) {
        if (!injected) {
          injected = true;
          // Append BEFORE the underlying history read runs, so this event
          // lands in both `listAfter`'s result AND the live buffer (the
          // listener is already subscribed). Only the route's `lastSeq`
          // guard stands between this and a duplicate.
          raceEvent = service.append({ projectId, kind: 'turn.completed', payload: {} });
        }
        return service.after(projectId, seq);
      },
    };

    await startServer(fakeDeps({ events: racyService }));
    const { reader, req } = await openSse(port, `/api/projects/${project.id}/events`);
    const frames = await reader.waitFor(2);

    expect(raceEvent).toBeDefined();
    expect(frames).toEqual([
      { seq: preRace.seq, kind: 'turn.started', payload: {} },
      { seq: raceEvent!.seq, kind: 'turn.completed', payload: {} },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(reader.all()).toHaveLength(2);

    req.destroy();
  });

  it('unsubscribes and clears the keepalive timer on client disconnect', async () => {
    let capturedUnsubscribe: (() => void) | undefined;
    const trackingService: EventService = {
      ...service,
      subscribe(projectId, listener) {
        const unsub = service.subscribe(projectId, listener);
        capturedUnsubscribe = vi.fn(unsub);
        return capturedUnsubscribe;
      },
    };
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    await startServer(fakeDeps({ events: trackingService }));
    // The response callback (headers received) only fires once the route's
    // fully synchronous handler — subscribe, replay, and keepalive setup all
    // included — has already run, so the keepalive timer is already set up.
    const { req, res } = await openSse(port, `/api/projects/${project.id}/events`);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.calls[0]?.[1]).toBe(15_000);
    const keepaliveFn = setIntervalSpy.mock.calls[0]?.[0] as () => void;
    const keepaliveHandle = setIntervalSpy.mock.results[0]?.value;

    // Fire the keepalive callback directly rather than waiting 15s for real.
    const nextChunk = new Promise<string>((resolve) => {
      res.once('data', (chunk: Buffer) => resolve(chunk.toString('utf8')));
    });
    keepaliveFn();
    expect(await nextChunk).toBe(': keepalive\n\n');

    req.destroy();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(capturedUnsubscribe).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalledWith(keepaliveHandle);

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});
