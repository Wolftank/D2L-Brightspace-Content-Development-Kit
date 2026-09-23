import type { AgentDriver } from './agent/AgentDriver.js';
import type { ProjectsRepo } from './db/projects.js';
import type { UsersRepo } from './db/users.js';
import type { EventBus } from './pipeline/events.js';

/** Everything the app needs, one field per service, repository, and driver. */
export interface Deps {
  users: UsersRepo;
  projects: ProjectsRepo;
  events: EventBus;
  driver: Pick<AgentDriver, 'probe'>;
}
