import { finished } from 'node:stream';
import { Router } from 'express';
import type { Deps } from '../deps.js';

export function buildsRouter(deps: Deps): Router {
  const router = Router();

  router.get('/builds/:buildId', (req, res) => {
    res.status(200).json({ build: deps.builds.get(req.user.id, req.params.buildId), deployments: [] });
  });

  router.get('/builds/:buildId/download', async (req, res) => {
    const { filename, stream, cancel } = await deps.builds.download(req.user.id, req.params.buildId);
    res.attachment(filename);
    stream.on('error', (err) => {
      console.error(`Failed to stream the zip of build ${req.params.buildId}:`, err);
      res.destroy(err);
    });
    stream.pipe(res);
    // Registered after pipe, whose own close handler pauses the stream that cancel resumes.
    finished(res, (err) => {
      if (err) cancel();
    });
  });

  return router;
}
