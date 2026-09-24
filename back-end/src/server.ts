import { join } from 'node:path';
import { createApp } from './app.js';
import { type Config, config } from './config.js';
import type { Deps } from './deps.js';
import { openDb } from './db/index.js';
import { createEventsRepo } from './db/events.js';
import { createProjectsRepo } from './db/projects.js';
import { createUsersRepo } from './db/users.js';
import { createEventService } from './pipeline/events.js';

function buildDeps(cfg: Config): Deps {
  const db = openDb(join(cfg.DATA_DIR, 'cdk.db'));

  return {
    users: createUsersRepo(db),
    projects: createProjectsRepo(db),
    events: createEventService(createEventsRepo(db)),
    driver: {
      async probe() {
        return { ok: false, detail: 'no agent driver configured yet' };
      },
    },
  };
}

const deps = buildDeps(config);

createApp(deps).listen(config.PORT, '127.0.0.1', () => {
  console.log(`back-end listening on http://127.0.0.1:${config.PORT}`);
});
