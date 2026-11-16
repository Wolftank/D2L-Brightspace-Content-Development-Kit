import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { FileListResponse, UploadFileResponse } from '@cdk/contract';
import type { Deps } from '../deps.js';
import { MAX_FILE_BYTES } from '../services/files.js';

/** Reads one file from the `file` field into memory, refusing anything over `MAX_FILE_BYTES` and any other field. */
const readUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0 },
  defParamCharset: 'utf8',
}).single('file');

const uploadedFile = z.object({ originalname: z.string(), buffer: z.instanceof(Buffer) }, 'must hold one file in the file field');

export function filesRouter(deps: Deps): Router {
  const router = Router();

  router.post('/projects/:projectId/files', readUpload, async (req: Request<{ projectId: string }>, res) => {
    const { originalname, buffer } = uploadedFile.parse(req.file);
    const file = await deps.files.upload(req.user.id, req.params.projectId, { name: originalname, bytes: buffer }, req.log);
    res.status(201).json({ file } satisfies UploadFileResponse);
  });

  router.get('/projects/:projectId/files', (req, res) => {
    res.status(200).json(deps.files.list(req.user.id, req.params.projectId) satisfies FileListResponse);
  });

  return router;
}
