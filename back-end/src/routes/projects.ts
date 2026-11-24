import { Router } from 'express';
import { z } from 'zod';
import type { Project, CreateProjectResponse, ProjectListResponse, UpdateProjectResponse } from '@cdk/contract';
import type { Deps } from '../deps.js';
import { BUILDABLE_AVENUES } from '../kit.js';

/** A project's title, when it is created and when it is renamed: trimmed, and not blank. */
const projectTitle = z.string().trim().min(1, 'must not be blank');

/** Creates a project, with an avenue CDK can build or none. Any other field, such as `targetCourse`, is dropped. */
const createProjectBody = z.object({
  title: projectTitle,
  avenue: z.enum(BUILDABLE_AVENUES).optional(),
});

/** Renames a project, changes its avenue, or both. Any other field is dropped, so a body with neither is refused. */
const updateProjectBody = z
  .object({
    title: projectTitle.optional(),
    avenue: z.enum(BUILDABLE_AVENUES).optional(),
  })
  .refine((body) => body.title !== undefined || body.avenue !== undefined, 'needs a title or an avenue');

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
    const { title, avenue } = updateProjectBody.parse(req.body);
    const { projectId } = req.params;
    let project: Project | undefined;
    // An avenue change can be refused with 409, so it goes first: a refused request renames nothing.
    if (avenue) project = await deps.avenues.setForOwner(req.user.id, projectId, avenue);
    if (title !== undefined) project = deps.projects.rename(req.user.id, projectId, title);
    if (!project) throw new Error('A validated update names a title or an avenue');
    res.status(200).json({ project } satisfies UpdateProjectResponse);
  });

  return router;
}
