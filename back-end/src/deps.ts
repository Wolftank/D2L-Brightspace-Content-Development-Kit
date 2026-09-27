import type { AgentDriver } from './agent/AgentDriver.js';
import type { UsersRepo } from './db/users.js';
import type { EventService } from './pipeline/events.js';
import type { BuildService } from './services/builds.js';
import type { ProjectService } from './services/projects.js';

/** Everything the app needs, one field per service, repository, and driver. */
export interface Deps {
  users: UsersRepo;
  projects: ProjectService;
  builds: Pick<BuildService, 'get' | 'download'>;
  events: EventService;
  driver: Pick<AgentDriver, 'probe'>;
}
