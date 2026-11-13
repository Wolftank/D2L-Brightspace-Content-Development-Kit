import type { User } from '../db/schema.js';
import type { Deps } from '../deps.js';
import type { TurnServiceDeps } from '../services/turns.js';

function unused(): never {
  throw new Error('not used by this test');
}

/** The instructor `fakeDeps` signs in when a test passes no `users`. */
export const FAKE_USER: User = { id: 'user-1', displayName: 'Test Instructor', email: null, role: 'instructor' };

/** A runner that never runs a turn, for a turn service whose turns the test only queues. */
export const idleRunner: TurnServiceDeps['runner'] = { executeTurn: async () => {}, cancel: () => {} };

/**
 * A complete `Deps` for tests of the app: `FAKE_USER`, a signed-in agent, the
 * local origins, and services that throw when called. A test passes the parts
 * it uses.
 */
export function fakeDeps(used: Partial<Deps> = {}): Deps {
  return {
    users: { ensureLocalUser: () => FAKE_USER, get: (id) => (id === FAKE_USER.id ? FAKE_USER : undefined) },
    projects: { create: unused, get: unused, list: unused },
    turns: { start: unused, cancel: unused },
    messages: { list: unused },
    builds: { get: unused, download: unused, previewFile: unused },
    events: { append: unused, after: unused, subscribe: unused },
    driver: { name: 'claude', probe: async () => ({ ok: true }), signIn: () => {} },
    preview: { origin: 'http://preview.localhost:3000', appOrigin: 'http://127.0.0.1:5173' },
    ...used,
  };
}
