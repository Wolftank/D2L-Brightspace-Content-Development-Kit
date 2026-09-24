import { Router } from 'express';
import { z } from 'zod';
import type { Event } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { NotFound } from '../errors.js';

const cursorSchema = z
  .string()
  .regex(/^\d+$/, 'must be a non-negative integer')
  .transform(Number);

const KEEPALIVE_MS = 15_000;

/**
 * Streams a project's events over Server-Sent Events, per docs/architecture.md's
 * "Event stream" section: replays everything after the client's last seen
 * `seq`, then attaches to the live feed, with no event lost or duplicated
 * across that handoff.
 */
export function eventsRouter(deps: Deps): Router {
  const router = Router();

  router.get('/projects/:projectId/events', (req, res, next) => {
    const project = deps.projects.get(req.user.id, req.params.projectId);
    if (!project) {
      next(new NotFound('Not found'));
      return;
    }

    const lastEventId = req.header('Last-Event-ID');
    const cursorSource = lastEventId !== undefined ? lastEventId : (req.query.after ?? '0');
    const parsedCursor = cursorSchema.safeParse(cursorSource);
    if (!parsedCursor.success) {
      next(parsedCursor.error);
      return;
    }
    const cursor = parsedCursor.data;

    res.status(200);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.flushHeaders();

    const write = (event: Event) => {
      res.write(`id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event.payload)}\n\n`);
    };

    // Subscribe before reading history, so any event appended during replay
    // is captured (buffered, not written yet) rather than missed. Draining
    // the buffer afterwards, guarded by `lastSeq`, is what keeps the handoff
    // from ever losing or duplicating an event.
    let replaying = true;
    let lastSeq = cursor;
    const buffered: Event[] = [];

    const unsubscribe = deps.events.subscribe(project.id, (event) => {
      if (replaying) {
        buffered.push(event);
        return;
      }
      if (event.seq > lastSeq) {
        lastSeq = event.seq;
        write(event);
      }
    });

    // Registered immediately after subscribing, and on `res` rather than
    // `req` (whose 'close' fires once the request body is read, not only on
    // client disconnect), so a throw from the replay below still leaves the
    // subscriber and any keepalive timer cleaned up once the connection ends.
    const timer: { keepalive?: NodeJS.Timeout } = {};
    res.on('close', () => {
      if (timer.keepalive) clearInterval(timer.keepalive);
      unsubscribe();
    });

    for (const event of deps.events.after(project.id, cursor)) {
      lastSeq = event.seq;
      write(event);
    }
    replaying = false;
    for (const event of buffered) {
      if (event.seq > lastSeq) {
        lastSeq = event.seq;
        write(event);
      }
    }

    timer.keepalive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, KEEPALIVE_MS);
  });

  return router;
}
