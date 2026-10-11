import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../deps.js';

/** Accepts text blocks only. Any other field is dropped. */
const sendMessageBody = z.object({
  content: z
    .array(z.object({ type: z.literal('text'), text: z.string().trim().min(1, 'must not be blank') }))
    .min(1, 'must contain at least one block'),
});

const listMessagesQuery = z.object({
  cursor: z.string().regex(/^\d+$/, 'must be a non-negative integer').transform(Number).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export function messagesRouter(deps: Deps): Router {
  const router = Router();

  router.get('/projects/:projectId/messages', (req, res) => {
    const query = listMessagesQuery.parse(req.query);
    res.status(200).json(deps.messages.list(req.user.id, req.params.projectId, query));
  });

  router.post('/projects/:projectId/messages', (req, res) => {
    const { content } = sendMessageBody.parse(req.body);
    res.status(202).json(deps.turns.start(req.user.id, req.params.projectId, content));
  });

  return router;
}
