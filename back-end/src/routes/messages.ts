import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../deps.js';

/** V1 accepts text blocks only. Fields later layers add are dropped. */
const sendMessageBody = z.object({
  content: z
    .array(z.object({ type: z.literal('text'), text: z.string().trim().min(1, 'must not be blank') }))
    .min(1, 'must contain at least one block'),
});

export function messagesRouter(deps: Deps): Router {
  const router = Router();

  router.post('/projects/:projectId/messages', (req, res) => {
    const { content } = sendMessageBody.parse(req.body);
    res.status(202).json(deps.turns.start(req.user.id, req.params.projectId, content));
  });

  return router;
}
