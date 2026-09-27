import { and, asc, eq, gt } from 'drizzle-orm';
import type { Db } from './index.js';
import { events, type Event } from './schema.js';

export interface InsertEventInput {
  projectId: string;
  turnId?: string | null;
  kind: string;
  payload: unknown;
}

export interface EventsRepo {
  insert(input: InsertEventInput): Event;
  /** Events for `projectId` with `seq` greater than `seq`, ascending — for replay. */
  listAfter(projectId: string, seq: number): Event[];
}

export function createEventsRepo(db: Db): EventsRepo {
  return {
    insert({ projectId, turnId, kind, payload }) {
      return db
        .insert(events)
        .values({ projectId, turnId: turnId ?? null, kind, payload, ts: Date.now() })
        .returning()
        .get();
    },
    listAfter(projectId, seq) {
      return db
        .select()
        .from(events)
        .where(and(eq(events.projectId, projectId), gt(events.seq, seq)))
        .orderBy(asc(events.seq))
        .all();
    },
  };
}
