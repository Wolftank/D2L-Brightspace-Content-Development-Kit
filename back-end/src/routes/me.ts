import { Router } from 'express';
import type { Deps } from '../deps.js';

export function meRouter(deps: Deps): Router {
  const router = Router();

  router.get('/me', async (req, res) => {
    const agent = await deps.driver.probe();
    res.status(200).json({ user: req.user, mode: 'local', agent });
  });

  return router;
}
