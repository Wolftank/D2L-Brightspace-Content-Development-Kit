import { join } from 'node:path';
import { createAgentDriver } from './agent/drivers.js';
import { createApp } from './app.js';
import { checkDataDir, type Config, ConfigError, loadConfig, loadEnvFile } from './config.js';
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
import { createTurnService } from './services/turns.js';
import { createWorkspaceService } from './services/workspaces.js';

function buildDeps(cfg: Config): { deps: Deps; runner: Runner; builds: BuildService } {
  const db = openDb(join(cfg.dataDir, 'cdk.db'));
  const projectsRepo = createProjectsRepo(db);
  const buildsRepo = createBuildsRepo(db);
  const turnsRepo = createTurnsRepo(db);
  const events = createEventService(createEventsRepo(db));
  const workspaces = createWorkspaceService({ dataDir: cfg.dataDir });
  const builds = createBuildService({ builds: buildsRepo, projects: projectsRepo, workspaces, events });
  const driver = createAgentDriver(cfg.agent);

  const runner = createRunner({
    turns: turnsRepo,
    messages: createMessagesRepo(db),
    events,
    sessions: createSessionService({ projects: projectsRepo, workspaces, driver }),
    workspaces,
    builds,
  });

  const deps: Deps = {
    users: createUsersRepo(db),
    projects: createProjectService({ projects: projectsRepo, workspaces, builds: buildsRepo, turns: turnsRepo }),
    turns: createTurnService({ projects: projectsRepo, turns: turnsRepo, runner }),
    builds,
    events,
    driver,
  };
  return { deps, runner, builds };
}

/** A startup message for a port the server could not listen on. */
function listenFailure(err: NodeJS.ErrnoException, port: number): string {
  switch (err.code) {
    case 'EADDRINUSE':
      return `Port ${port} on 127.0.0.1 is already in use, probably by another back end. Stop it, or set PORT in back-end/.env and API_TARGET for the front end.`;
    case 'EACCES':
      return `Port ${port} on 127.0.0.1 is reserved or not permitted. Set another PORT in back-end/.env.`;
    default:
      return `Cannot listen on 127.0.0.1:${port}: ${err.message}`;
  }
}

function start(): void {
  let cfg: Config;
  try {
    loadEnvFile();
    cfg = loadConfig(process.env);
    checkDataDir(cfg.dataDir);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(err.message);
    process.exit(1);
  }

  const { deps, runner, builds } = buildDeps(cfg);
  createApp(deps).listen(cfg.port, '127.0.0.1', (err) => {
    if (err) {
      console.error(listenFailure(err, cfg.port));
      process.exit(1);
    }
    runner.failInterrupted();
    builds.failInterrupted();
    console.log(`back-end listening on http://127.0.0.1:${cfg.port} (data in ${cfg.dataDir})`);
  });
}

start();
