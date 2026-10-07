import type { EventKind, EventPayloads } from '@cdk/contract';
import type { EventsRepo } from '../db/events.js';
import type { Event } from '../db/schema.js';

/** An event to store and push. Its `payload` is the contract's payload for its `kind`. */
export interface AppendEventInput<K extends EventKind = EventKind> {
  projectId: string;
  turnId?: string;
  kind: K;
  payload: EventPayloads[K];
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
  append<K extends EventKind>(input: AppendEventInput<K>): Event;
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
