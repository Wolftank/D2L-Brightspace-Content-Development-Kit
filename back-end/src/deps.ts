import type { AgentDriver } from './agent/AgentDriver.js';
import type { ProjectsRepo } from './db/projects.js';
import type { UsersRepo } from './db/users.js';
import type { EventService } from './pipeline/events.js';

/** Everything the app needs, one field per service, repository, and driver. */
export interface Deps {
  users: UsersRepo;
  projects: ProjectsRepo;
  events: EventService;
  driver: Pick<AgentDriver, 'probe'>;
}
