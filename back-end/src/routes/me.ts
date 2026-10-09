import { Router } from 'express';
import type { MeResponse } from '@cdk/contract';
import type { Deps } from '../deps.js';

export function meRouter(deps: Deps): Router {
  const router = Router();

  router.get('/me', async (req, res) => {
    const agent = { name: deps.driver.name, ...(await deps.driver.probe()) };
    res.status(200).json({ user: req.user, mode: 'local', agent } satisfies MeResponse);
  });

  return router;
}
