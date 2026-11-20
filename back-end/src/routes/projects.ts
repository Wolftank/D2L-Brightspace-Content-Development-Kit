import { Router } from 'express';
import { z } from 'zod';
import type { CreateProjectResponse, ProjectListResponse, UpdateProjectResponse } from '@cdk/contract';
import type { Deps } from '../deps.js';
import { BUILDABLE_AVENUES } from '../kit.js';

/** Creates a project, with an avenue CDK can build or none. Any other field, such as `targetCourse`, is dropped. */
const createProjectBody = z.object({
  title: z.string().trim().min(1, 'must not be blank'),
  avenue: z.enum(BUILDABLE_AVENUES).optional(),
});

const updateProjectBody = z.object({
  avenue: z.enum(BUILDABLE_AVENUES),
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

  router.patch('/projects/:projectId', async (req, res) => {
    const input = updateProjectBody.parse(req.body);
    const project = await deps.avenues.setForOwner(req.user.id, req.params.projectId, input.avenue);
    res.status(200).json({ project } satisfies UpdateProjectResponse);
  });

  return router;
}
