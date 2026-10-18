import { join } from 'node:path';
import { createAgentDriver } from './agent/drivers.js';
import { createApp } from './app.js';
import { checkDataDir, type Config, ConfigError, loadConfig, loadEnvFile, loggedSettings } from './config.js';
import type { Deps } from './deps.js';
import { createBuildsRepo } from './db/builds.js';
import { openDb } from './db/index.js';
import { createEventsRepo } from './db/events.js';
import { createMessagesRepo } from './db/messages.js';
import { createProjectsRepo } from './db/projects.js';
import { createTurnsRepo } from './db/turns.js';
import { createUsersRepo } from './db/users.js';
import { log, startLogging } from './log.js';
import { createEventService } from './pipeline/events.js';
import { createRunner, type Runner } from './pipeline/runner.js';
import { createSessionService } from './pipeline/sessions.js';
import { createBuildService, type BuildService } from './services/builds.js';
import { createMessageService } from './services/messages.js';
import { createProjectService } from './services/projects.js';
import { createTurnService } from './services/turns.js';
import { createWorkspaceService } from './services/workspaces.js';
import { createCdkTools } from './tools/index.js';

function buildDeps(cfg: Config): { deps: Deps; runner: Runner; builds: BuildService } {
  const db = openDb(join(cfg.dataDir, 'cdk.db'));
  const projectsRepo = createProjectsRepo(db);
  const buildsRepo = createBuildsRepo(db);
  const turnsRepo = createTurnsRepo(db);
  const messagesRepo = createMessagesRepo(db);
  const events = createEventService(createEventsRepo(db));
  const workspaces = createWorkspaceService({ dataDir: cfg.dataDir });
  const builds = createBuildService({ builds: buildsRepo, projects: projectsRepo, workspaces, events });
  const driver = createAgentDriver(cfg.agent);

  const runner = createRunner({
    turns: turnsRepo,
    messages: messagesRepo,
    events,
    sessions: createSessionService({
      projects: projectsRepo,
      workspaces,
      driver,
      tools: (projectId) => createCdkTools({ projects: projectsRepo, workspaces, builds }, projectId),
    }),
    workspaces,
    builds,
    turnLimits: cfg.turnLimits,
  });

  const deps: Deps = {
    users: createUsersRepo(db),
    projects: createProjectService({ projects: projectsRepo, workspaces, builds: buildsRepo, turns: turnsRepo }),
    turns: createTurnService({ projects: projectsRepo, turns: turnsRepo, runner }),
    messages: createMessageService({ projects: projectsRepo, messages: messagesRepo }),
    builds,
    events,
    driver,
    preview: { origin: cfg.previewOrigin, appOrigin: cfg.appOrigin },
    appDir: cfg.appDir,
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

async function start(): Promise<void> {
  let cfg: Config;
  try {
    loadEnvFile();
    cfg = loadConfig(process.env);
    checkDataDir(cfg.dataDir);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    // Without valid settings there is no log file; the desktop app shows standard error when the back end fails to start.
    console.error(err.message);
    process.exit(1);
  }

  await startLogging(join(cfg.dataDir, 'logs'), cfg.logLevel);
  process.on('uncaughtExceptionMonitor', (err) => log.fatal({ err }, 'The back end crashed'));
  log.info({ settings: loggedSettings(cfg) }, 'back-end starting');

  const { deps, runner, builds } = buildDeps(cfg);
  createApp(deps).listen(cfg.port, '127.0.0.1', (err) => {
    if (err) {
      const message = listenFailure(err, cfg.port);
      log.fatal({ err }, message);
      console.error(message);
      process.exit(1);
    }
    runner.failInterrupted();
    builds.failInterrupted();
    log.info({ url: `http://127.0.0.1:${cfg.port}`, previewOrigin: cfg.previewOrigin }, 'back-end listening');
  });
}

await start();
