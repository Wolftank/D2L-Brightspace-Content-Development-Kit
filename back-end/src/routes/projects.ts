import { Router } from 'express';
import { z } from 'zod';
import type { CreateProjectResponse, ProjectListResponse } from '@cdk/contract';
import type { Deps } from '../deps.js';

/** Creates SCORM or content-topic projects. Any other field, such as `targetCourse`, is dropped. */
const createProjectBody = z.object({
  title: z.string().trim().min(1, 'must not be blank'),
  avenue: z.enum(['scorm', 'topic']).default('scorm'),
});

export function projectsRouter(deps: Deps): Router {
  const router = Router();

  router.get('/projects', (req, res) => {
    res.status(200).json(deps.projects.list(req.user.id) satisfies ProjectListResponse);
  });

  router.post('/projects', async (req, res) => {
    const input = createProjectBody.parse(req.body);
    const project = await deps.projects.create(req.user.id, input);
    res.status(201).json({ project } satisfies CreateProjectResponse);
  });

  router.get('/projects/:projectId', (req, res) => {
    res.status(200).json(deps.projects.get(req.user.id, req.params.projectId));
  });

  return router;
}
