import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../deps.js';

/** V1 accepts text blocks only; the other block kinds come with later layers. */
const sendMessageBody = z.object({
  content: z
    .array(z.object({ type: z.literal('text'), text: z.string() }))
    .min(1, 'must have at least one block')
    .refine((blocks) => blocks.some((block) => block.text.trim() !== ''), 'must contain non-blank request text'),
});

export function messagesRouter(deps: Deps): Router {
  const router = Router();

  router.post('/projects/:projectId/messages', (req, res) => {
    const { content } = sendMessageBody.parse(req.body);
    const started = deps.turns.start(req.user.id, req.params.projectId, content);
    res.status(202).json(started);
  });

  return router;
}
