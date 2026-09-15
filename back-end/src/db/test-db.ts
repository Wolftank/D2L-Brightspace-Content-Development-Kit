import { openDb } from './index.js';

/** Opens a fresh in-memory database with migrations applied, for tests. */
export function testDb() {
  return openDb(':memory:');
}
