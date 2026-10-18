import type { AgentDriver } from './agent/AgentDriver.js';
import type { UsersRepo } from './db/users.js';
import type { EventService } from './pipeline/events.js';
import type { PreviewSettings } from './preview/routes.js';
import type { BuildService } from './services/builds.js';
import type { MessageService } from './services/messages.js';
import type { ProjectService } from './services/projects.js';
import type { TurnService } from './services/turns.js';

/** Everything the app needs: one field per service, repository, and driver, plus the preview origin's settings and the built front end. */
export interface Deps {
  users: UsersRepo;
  projects: ProjectService;
  turns: TurnService;
  messages: MessageService;
  builds: Pick<BuildService, 'get' | 'download' | 'previewFile'>;
  events: EventService;
  driver: Pick<AgentDriver, 'name' | 'probe'>;
  preview: PreviewSettings;
  /** When set, the origin guard requires this token in the `cdk_launch` cookie on every API request. */
  launchToken?: string;
  /** The built front end to serve on the app origin, when the back end serves the app. */
  appDir?: string;
}
