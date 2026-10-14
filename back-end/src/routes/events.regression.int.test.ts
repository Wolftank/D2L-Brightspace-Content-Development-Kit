import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { createBuildsRepo } from '../db/builds.js';
import { createEventsRepo } from '../db/events.js';
import { createMessagesRepo } from '../db/messages.js';
import { createProjectsRepo } from '../db/projects.js';
import { users as usersTable, type Event } from '../db/schema.js';
import { testDb } from '../db/test-db.js';
import { createTurnsRepo } from '../db/turns.js';
import { createUsersRepo } from '../db/users.js';
import type { Deps } from '../deps.js';
import { createEventService, type EventService } from '../pipeline/events.js';
import { createBuildService } from '../services/builds.js';
import { createMessageService } from '../services/messages.js';
import { createProjectService } from '../services/projects.js';
import { createTurnService } from '../services/turns.js';
import { createWorkspaceService } from '../services/workspaces.js';
import { type Frame, openSse } from '../test/sse.js';

/**
 * R7 (#67): replay, cursor precedence, cursor validation, keepalive,
 * ownership and reconnect on the event stream, run through the real app with
 * real services over an in-memory database, using the shared helpers in
 * `test/sse.ts` (Q3). Another project's events are stored between this
 * project's, so every replay also proves the stream stays scoped to its project.
 */

const STREAM = '/api/projects/mine/events';

function asFrames(events: Event[]): Frame[] {
  return events.map(({ seq, kind, payload }) => ({ seq, kind, payload }));
}

describe('R7 regression: event stream and reconnect', () => {
  let deps: Deps;
  let events: EventService;
  let stored: Event[];
  let server: http.Server;
  let port: number;
  let openRequests: http.ClientRequest[];

  async function open(path: string, headers: Record<string, string> = {}) {
    const stream = await openSse(port, path, headers);
    openRequests.push(stream.req);
    return stream;
  }

  function appendLive(): Event {
    return events.append({ projectId: 'mine', kind: 'turn.completed', payload: { turnId: 'turn-1' } });
  }

  /**
   * Opens the stream and asserts it replays exactly `expected`, in order. A
   * live event is then appended as a marker: frames arrive in the order they
   * were written, so once the marker arrives right after `expected`, no extra
   * or duplicate replay frame can still be on its way.
   */
  async function expectReplay(path: string, headers: Record<string, string>, expected: Event[]) {
    const { reader } = await open(path, headers);
    await reader.waitFor(expected.length);
    const marker = appendLive();
    await reader.waitFor(expected.length + 1);
    expect(reader.all()).toEqual(asFrames([...expected, marker]));
  }

  beforeEach(async () => {
    const db = testDb();
    const projectsRepo = createProjectsRepo(db);
    const buildsRepo = createBuildsRepo(db);
    const turnsRepo = createTurnsRepo(db);
    const workspaces = createWorkspaceService({ dataDir: join(tmpdir(), 'cdk-r7-unused') });
    events = createEventService(createEventsRepo(db));
    deps = {
      users: createUsersRepo(db),
      projects: createProjectService({ projects: projectsRepo, workspaces, builds: buildsRepo, turns: turnsRepo }),
      turns: createTurnService({ projects: projectsRepo, turns: turnsRepo, runner: { executeTurn: async () => {} } }),
      builds: createBuildService({ builds: buildsRepo, projects: projectsRepo, workspaces, events }),
      events,
      messages: createMessageService({ projects: projectsRepo, messages: createMessagesRepo(db) }),
      driver: { name: 'claude', probe: async () => ({ ok: true, version: '0.0.0' }) },
      preview: { origin: 'http://preview.localhost:3000', appOrigin: 'http://127.0.0.1:5173' },
    };

    const owner = deps.users.ensureLocalUser();
    projectsRepo.create({ id: 'mine', ownerId: owner.id, title: 'Cell division practice', avenue: 'scorm' });
    db.insert(usersTable).values({ id: 'someone-else', displayName: 'Someone Else', email: null, role: 'instructor' }).run();
    projectsRepo.create({ id: 'not-mine', ownerId: 'someone-else', title: 'Not yours', avenue: 'scorm' });

    const mine = (text: string) => events.append({ projectId: 'mine', kind: 'turn.status', payload: { turnId: 'turn-1', text } });
    const notMine = () => events.append({ projectId: 'not-mine', kind: 'turn.status', payload: { turnId: 'turn-9', text: 'Not yours' } });
    stored = [
      events.append({ projectId: 'mine', kind: 'turn.started', payload: { turnId: 'turn-1', startedAt: 1 } }),
      mine('Reading your request'),
    ];
    notMine();
    stored.push(mine('Building from the SCORM starter'));
    notMine();
    stored.push(mine('Running the QA gate'), mine('QA gate passed'));

    openRequests = [];
    server = createApp(deps).listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    vi.useRealTimers();
    for (const req of openRequests) req.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe('replay', () => {
    it('with neither cursor, replays every event from the beginning, in order, then goes live', async () => {
      await expectReplay(STREAM, {}, stored);
    });

    it('with Last-Event-ID: n, sends exactly the events after n, in order, with no duplicates', async () => {
      await expectReplay(STREAM, { 'Last-Event-ID': String(stored[1]!.seq) }, stored.slice(2));
    });

    it('with ?after=n, sends exactly the events after n, in order, with no duplicates', async () => {
      await expectReplay(`${STREAM}?after=${stored[1]!.seq}`, {}, stored.slice(2));
    });

    it('with a cursor at the latest event, replays nothing and goes straight to live', async () => {
      await expectReplay(STREAM, { 'Last-Event-ID': String(stored.at(-1)!.seq) }, []);
    });
  });

  describe('when both cursors are sent', () => {
    it.each<[string, number, number]>([
      ['later', 3, 0],
      ['earlier', 0, 3],
    ])('Last-Event-ID wins when it is the %s cursor', async (_, headerIndex, queryIndex) => {
      const header = stored[headerIndex]!.seq;
      const query = stored[queryIndex]!.seq;

      await expectReplay(`${STREAM}?after=${query}`, { 'Last-Event-ID': String(header) }, stored.slice(headerIndex + 1));
    });
  });

  describe('invalid cursors return the standard validation error, not a stream', () => {
    const cursors: Array<[string, string]> = [
      ['-1', 'negative'],
      ['2.5', 'non-integer'],
      ['abc', 'text'],
    ];

    it.each(cursors)('Last-Event-ID: %s (%s)', async (value) => {
      const res = await request(createApp(deps)).get(STREAM).set('Last-Event-ID', value);

      expect(res.status).toBe(400);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.body.error.code).toBe('invalid_request');
    });

    it.each(cursors)('?after=%s (%s)', async (value) => {
      const res = await request(createApp(deps)).get(STREAM).query({ after: value });

      expect(res.status).toBe(400);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.body.error.code).toBe('invalid_request');
    });
  });

  it('writes a keepalive comment every 15 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { reader } = await open(STREAM, { 'Last-Event-ID': String(stored.at(-1)!.seq) });

    vi.advanceTimersByTime(14_999);
    appendLive();
    await reader.waitFor(1);
    expect(reader.comments()).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(await reader.waitForComments(1)).toEqual(['keepalive']);

    vi.advanceTimersByTime(15_000);
    expect(await reader.waitForComments(2)).toEqual(['keepalive', 'keepalive']);
  });

  it("answers an unknown project and another owner's project with the same standard 404, not a stream", async () => {
    const unknown = await request(createApp(deps)).get('/api/projects/no-such-project/events');
    const notMine = await request(createApp(deps)).get('/api/projects/not-mine/events');

    for (const res of [unknown, notMine]) {
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.body.error.code).toBe('not_found');
    }
    expect(notMine.body).toEqual(unknown.body);
  });

  it('a client that drops and reconnects with Last-Event-ID gets only the events it missed, then the live feed', async () => {
    const first = await open(STREAM);
    const seen = await first.reader.waitFor(stored.length);
    first.req.destroy();

    const missed = [appendLive(), appendLive()];

    await expectReplay(STREAM, { 'Last-Event-ID': String(seen.at(-1)!.seq) }, missed);
  });
});
