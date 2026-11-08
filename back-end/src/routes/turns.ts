import { Router } from 'express';
import type { Deps } from '../deps.js';

export function turnsRouter(deps: Deps): Router {
  const router = Router();

  router.post('/turns/:turnId/cancel', (req, res) => {
    deps.turns.cancel(req.user.id, req.params.turnId, req.log);
    res.status(202).end();
  });

  return router;
}
