import { Router } from 'express';
import { z } from 'zod';
import type { MessageHistoryResponse } from '@cdk/contract';
import type { Deps } from '../deps.js';

/** The most files one message can carry. */
export const MAX_FILES_PER_MESSAGE = 10;

/**
 * Text blocks, at least one, and up to `MAX_FILES_PER_MESSAGE` file blocks,
 * each naming a different file. Any other field is dropped.
 */
const sendMessageBody = z.object({
  content: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('text'), text: z.string().trim().min(1, 'must not be blank') }),
        z.object({ type: z.literal('file'), fileId: z.string().min(1) }),
      ]),
    )
    .refine((blocks) => blocks.some((block) => block.type === 'text'), 'must contain at least one text block')
    .refine((blocks) => fileIds(blocks).length <= MAX_FILES_PER_MESSAGE, `must name at most ${MAX_FILES_PER_MESSAGE} files`)
    .refine((blocks) => new Set(fileIds(blocks)).size === fileIds(blocks).length, 'must name each file once'),
});

function fileIds(blocks: Array<{ type: 'text' } | { type: 'file'; fileId: string }>): string[] {
  return blocks.flatMap((block) => (block.type === 'file' ? [block.fileId] : []));
}

const listMessagesQuery = z.object({
  cursor: z.string().regex(/^\d+$/, 'must be a non-negative integer').transform(Number).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export function messagesRouter(deps: Deps): Router {
  const router = Router();

  router.get('/projects/:projectId/messages', (req, res) => {
    const query = listMessagesQuery.parse(req.query);
    res.status(200).json(deps.messages.list(req.user.id, req.params.projectId, query) satisfies MessageHistoryResponse);
  });

  router.post('/projects/:projectId/messages', (req, res) => {
    const { content } = sendMessageBody.parse(req.body);
    res.status(202).json(deps.turns.start(req.user.id, req.params.projectId, content, req.log));
  });

  return router;
}
