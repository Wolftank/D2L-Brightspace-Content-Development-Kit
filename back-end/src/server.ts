import type { Server } from 'node:http';
import { join } from 'node:path';
import type { AgentDriver } from './agent/AgentDriver.js';
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
import { log } from './log.js';
import { startLogging } from './log-file.js';
import { createEventService } from './pipeline/events.js';
import { createRunner, type Runner } from './pipeline/runner.js';
import { createSessionService, type SessionService } from './pipeline/sessions.js';
import { createBuildService, type BuildService } from './services/builds.js';
import { createMessageService } from './services/messages.js';
import { createProjectService } from './services/projects.js';
import { createTurnService } from './services/turns.js';
import { createWorkspaceService } from './services/workspaces.js';
import { createCdkTools } from './tools/index.js';

interface BackEnd {
  deps: Deps;
  driver: AgentDriver;
  db: ReturnType<typeof openDb>;
  runner: Runner;
  sessions: SessionService;
  builds: BuildService;
}

function buildBackEnd(cfg: Config): BackEnd {
  const db = openDb(join(cfg.dataDir, 'cdk.db'));
  const projectsRepo = createProjectsRepo(db);
  const buildsRepo = createBuildsRepo(db);
  const turnsRepo = createTurnsRepo(db);
  const messagesRepo = createMessagesRepo(db);
  const events = createEventService(createEventsRepo(db));
  const workspaces = createWorkspaceService({ dataDir: cfg.dataDir });
  const builds = createBuildService({ builds: buildsRepo, projects: projectsRepo, workspaces, events });
  const driver = createAgentDriver(cfg.agent);

  const sessions = createSessionService({
    projects: projectsRepo,
    workspaces,
    driver,
    tools: (projectId) => createCdkTools({ projects: projectsRepo, workspaces, builds }, projectId),
  });
  const runner = createRunner({
    turns: turnsRepo,
    messages: messagesRepo,
    events,
    sessions,
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
    launchToken: cfg.launchToken,
    appDir: cfg.appDir,
  };
  return { deps, driver, db, runner, sessions, builds };
}

/** Closes the server, ends a waiting sign-in, cancels running turns, closes the sessions and the database, and exits. */
async function shutDown(server: Server, { driver, db, runner, sessions }: BackEnd, trigger: string): Promise<void> {
  log.info({ trigger }, 'back-end stopping');
  try {
    server.close();
    server.closeAllConnections();
    driver.endSignIn();
    await runner.cancelAll();
    await sessions.closeAll();
    db.$client.close();
    log.info('back-end stopped');
  } catch (err) {
    log.error({ err }, 'The back end did not stop cleanly');
    process.exitCode = 1;
  }
  process.exit();
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

  const logsDir = join(cfg.dataDir, 'logs');
  await startLogging(logsDir, cfg.logLevel);
  // The desktop app opens this folder from its menu.
  process.send?.({ logsDir });
  process.on('uncaughtExceptionMonitor', (err) => log.fatal({ err }, 'The back end crashed'));
  log.info({ settings: loggedSettings(cfg) }, 'back-end starting');

  const backEnd = buildBackEnd(cfg);
  const { runner, builds } = backEnd;
  const server = createApp(backEnd.deps).listen(cfg.port, '127.0.0.1', (err) => {
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

  let stopping = false;
  function stop(trigger: string): void {
    if (stopping) return;
    stopping = true;
    void shutDown(server, backEnd, trigger);
  }
  // The desktop app sends 'shutdown' when it quits; its channel closes if it crashes.
  process.on('message', (message) => {
    if (message === 'shutdown') stop('app quit');
  });
  process.once('disconnect', () => stop('app gone'));
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
}

await start();
