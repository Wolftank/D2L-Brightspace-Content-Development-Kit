import type { EventsRepo } from '../db/events.js';
import type { Event } from '../db/schema.js';

/** The event kinds in docs/architecture.md's "Event stream" table. No others are valid. */
export type AppEventKind =
  | 'turn.started'
  | 'turn.status'
  | 'message.delta'
  | 'message.completed'
  | 'tool.started'
  | 'tool.finished'
  | 'build.created'
  | 'build.updated'
  | 'deployment.updated'
  | 'turn.completed'
  | 'turn.failed'
  | 'turn.cancelled';

export interface AppendEventInput {
  projectId: string;
  turnId?: string;
  kind: AppEventKind;
  payload: unknown;
}

export type EventListener = (event: Event) => void;

/**
 * The event service: stores every event and notifies a project's live
 * subscribers. Per docs/architecture.md's "Event stream", the server always
 * persists before pushing, so replay and the live feed can never disagree
 * about what happened.
 */
export interface EventService {
  /** Persists the event, then notifies `projectId`'s live subscribers with the stored, seq-assigned row. */
  append(input: AppendEventInput): Event;
  /** Stored events for `projectId` after `seq`, ascending — for replay. */
  after(projectId: string, seq: number): Event[];
  /** Registers `listener` for `projectId`'s live events. Returns a function that unregisters it. */
  subscribe(projectId: string, listener: EventListener): () => void;
}

export function createEventService(eventsRepo: EventsRepo): EventService {
  const subscribers = new Map<string, Set<EventListener>>();

  return {
    append(input) {
      const event = eventsRepo.insert(input);
      for (const listener of subscribers.get(input.projectId) ?? []) {
        listener(event);
      }
      return event;
    },
    after(projectId, seq) {
      return eventsRepo.listAfter(projectId, seq);
    },
    subscribe(projectId, listener) {
      let listeners = subscribers.get(projectId);
      if (!listeners) {
        listeners = new Set();
        subscribers.set(projectId, listeners);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) subscribers.delete(projectId);
      };
    },
  };
}
