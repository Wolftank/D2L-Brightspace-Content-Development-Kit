import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../deps.js';

/** V1 creates SCORM projects only. Fields later layers add, such as `targetCourse`, are dropped. */
const createProjectBody = z.object({
  title: z.string().trim().min(1, 'must not be blank'),
  avenue: z.literal('scorm').default('scorm'),
});

export function projectsRouter(deps: Deps): Router {
  const router = Router();

  router.post('/projects', async (req, res) => {
    const input = createProjectBody.parse(req.body);
    const project = await deps.projects.create(req.user.id, input);
    res.status(201).json({ project });
  });

  router.get('/projects/:projectId', (req, res) => {
    res.status(200).json(deps.projects.get(req.user.id, req.params.projectId));
  });

  return router;
}
