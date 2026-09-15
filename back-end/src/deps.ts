import type { AgentDriver } from './agent/AgentDriver.js';
import type { UsersRepo } from './db/users.js';

/** Everything the app needs, one field per service, repository, and driver. */
export interface Deps {
  users: UsersRepo;
  driver: Pick<AgentDriver, 'probe'>;
}
