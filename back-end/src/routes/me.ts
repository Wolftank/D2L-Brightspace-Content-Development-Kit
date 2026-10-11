import { Router } from 'express';
import type { MeResponse } from '@cdk/contract';
import type { Deps } from '../deps.js';

export function meRouter(deps: Deps): Router {
  const router = Router();

  router.get('/me', async (req, res) => {
    const probe = await deps.driver.probe();
    res.status(200).json({
      user: req.user,
      mode: 'local',
      agent: { name: deps.driver.name, ok: probe.ok, version: probe.version, detail: probe.detail },
    } satisfies MeResponse);
  });

  return router;
}
