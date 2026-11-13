import { Router } from 'express';
import type { Deps } from '../deps.js';

export function agentRouter(deps: Deps): Router {
  const router = Router();

  router.post('/agent/sign-in', (req, res) => {
    deps.driver.signIn();
    req.log.info({ agent: deps.driver.name }, 'Agent sign-in started');
    res.status(202).end();
  });

  return router;
}
