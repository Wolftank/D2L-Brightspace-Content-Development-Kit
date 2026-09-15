import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

/** The requested resource does not exist, or is not owned by the caller. */
export class NotFound extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFound';
  }
}

/** A project already has a turn running; the caller must wait for it. */
export class TurnActive extends Error {
  constructor(public readonly turnId: string) {
    super('A turn is already active for this project');
    this.name = 'TurnActive';
  }
}

/** A turn was requested for a project whose workspace directory is gone. */
export class WorkspaceMissing extends Error {
  constructor(message = 'Workspace missing') {
    super(message);
    this.name = 'WorkspaceMissing';
  }
}

/**
 * Maps thrown errors to the envelope `{ error: { code, message, details? } }`
 * from docs/architecture.md. Registered last in `createApp`.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'invalid_request', message: 'Invalid request', details: { issues: err.issues } },
    });
    return;
  }

  if (err instanceof SyntaxError && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'invalid_json', message: 'Invalid JSON body' } });
    return;
  }

  if (err instanceof NotFound) {
    res.status(404).json({ error: { code: 'not_found', message: err.message } });
    return;
  }

  if (err instanceof TurnActive) {
    res.status(409).json({
      error: { code: 'turn_active', message: err.message, details: { turnId: err.turnId } },
    });
    return;
  }

  console.error(err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } });
};
