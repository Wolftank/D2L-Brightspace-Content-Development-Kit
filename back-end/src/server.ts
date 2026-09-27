import { join } from 'node:path';
import { createClaudeAgentDriver } from './agent/claude.js';
import { createApp } from './app.js';
import { type Config, config } from './config.js';
import type { Deps } from './deps.js';
import { createBuildsRepo } from './db/builds.js';
import { openDb } from './db/index.js';
import { createEventsRepo } from './db/events.js';
import { createMessagesRepo } from './db/messages.js';
import { createProjectsRepo } from './db/projects.js';
import { createTurnsRepo } from './db/turns.js';
import { createUsersRepo } from './db/users.js';
import { createEventService } from './pipeline/events.js';
import { createRunner, type Runner } from './pipeline/runner.js';
import { createSessionService } from './pipeline/sessions.js';
import { createBuildService, type BuildService } from './services/builds.js';
import { createProjectService } from './services/projects.js';
import { createWorkspaceService } from './services/workspaces.js';

function buildDeps(cfg: Config): { deps: Deps; runner: Runner; builds: BuildService } {
  const db = openDb(join(cfg.DATA_DIR, 'cdk.db'));
  const projectsRepo = createProjectsRepo(db);
  const buildsRepo = createBuildsRepo(db);
  const turns = createTurnsRepo(db);
  const events = createEventService(createEventsRepo(db));
  const workspaces = createWorkspaceService({ dataDir: cfg.DATA_DIR });
  const builds = createBuildService({ builds: buildsRepo, projects: projectsRepo, workspaces, events });

  const runner = createRunner({
    turns,
    messages: createMessagesRepo(db),
    events,
    sessions: createSessionService({ projects: projectsRepo, workspaces, driver: createClaudeAgentDriver() }),
    workspaces,
    builds,
  });

  const deps: Deps = {
    users: createUsersRepo(db),
    projects: createProjectService({ projects: projectsRepo, workspaces, builds: buildsRepo, turns }),
    builds,
    events,
    driver: {
      async probe() {
        return { ok: false, detail: 'no agent driver configured yet' };
      },
    },
  };
  return { deps, runner, builds };
}

const { deps, runner, builds } = buildDeps(config);
runner.failInterrupted();
builds.failInterrupted();

createApp(deps).listen(config.PORT, '127.0.0.1', () => {
  console.log(`back-end listening on http://127.0.0.1:${config.PORT}`);
});
