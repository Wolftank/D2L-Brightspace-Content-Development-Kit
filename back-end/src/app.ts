import express, { type Express } from 'express';
import type { Deps } from './deps.js';
import { errorHandler, NotFound } from './errors.js';
import { identity } from './identity.js';
import { buildsRouter } from './routes/builds.js';
import { eventsRouter } from './routes/events.js';
import { healthRouter } from './routes/health.js';
import { meRouter } from './routes/me.js';
import { projectsRouter } from './routes/projects.js';

/** Builds the app from `deps` without listening. Real deps come from
 *  `server.ts`; tests pass fakes. */
export function createApp(deps: Deps): Express {
  const app = express();

  app.use(express.json());
  app.use(identity(deps));

  app.use('/api', healthRouter());
  app.use('/api', meRouter(deps));
  app.use('/api', projectsRouter(deps));
  app.use('/api', buildsRouter(deps));
  app.use('/api', eventsRouter(deps));
  app.use('/api', (_req, _res, next) => next(new NotFound('Not found')));

  app.use(errorHandler);

  return app;
}
