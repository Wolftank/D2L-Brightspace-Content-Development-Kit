import type { ApiErrorBody, NextStep } from '@cdk/contract';
import type { ErrorRequestHandler, Response } from 'express';
import { ZodError } from 'zod';

/** The requested resource does not exist, or is not owned by the caller. */
export class NotFound extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFound';
  }
}

/** A project already has a `queued` or `running` turn; the caller must wait for it. */
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

/** A download was requested for a build whose status is not `ready`. */
export class BuildNotReady extends Error {
  constructor(public readonly status: string) {
    super(`Only a ready build can be downloaded; this build is ${status}`);
    this.name = 'BuildNotReady';
  }
}

/** A build's `imsmanifest.xml`, or a file it declares, is missing from the build. */
export class BuildIncomplete extends Error {
  constructor(public readonly missing: string[]) {
    super(`The build is missing files its manifest needs: ${missing.join(', ')}`);
    this.name = 'BuildIncomplete';
  }
}

/** Each API error's status, what the instructor reads, and the one thing to do next. */
export const API_ERRORS = {
  invalid_request: { status: 400, message: "The request couldn't be read.", nextStep: 'send_again' },
  invalid_json: { status: 400, message: "The request couldn't be read.", nextStep: 'send_again' },
  payload_too_large: { status: 413, message: 'The request is too large.', nextStep: 'smaller_request' },
  not_found: { status: 404, message: "This project or build doesn't exist.", nextStep: 'new_project' },
  turn_active: { status: 409, message: 'A request is already running for this project.', nextStep: 'wait' },
  build_not_ready: { status: 409, message: "This build isn't ready to download.", nextStep: 'try_later' },
  build_incomplete: { status: 409, message: 'This build is missing files it needs.', nextStep: 'send_again' },
  internal_error: { status: 500, message: 'Something went wrong.', nextStep: 'try_later' },
} satisfies Record<string, { status: number; message: string; nextStep: NextStep }>;

function send(res: Response, code: keyof typeof API_ERRORS, details?: unknown): void {
  const { status, message, nextStep } = API_ERRORS[code];
  res.status(status).json({ error: { code, message, nextStep, details } } satisfies ApiErrorBody);
}

/**
 * Maps thrown errors to the envelope `{ error: { code, message, nextStep, details? } }`
 * from docs/architecture.md. Registered last in `createApp`.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) return send(res, 'invalid_request', { issues: err.issues });
  if (err instanceof SyntaxError && (err as { type?: string }).type === 'entity.parse.failed') return send(res, 'invalid_json');
  if ((err as { type?: string }).type === 'entity.too.large') return send(res, 'payload_too_large');
  if (err instanceof NotFound) return send(res, 'not_found');
  if (err instanceof TurnActive) return send(res, 'turn_active', { turnId: err.turnId });
  if (err instanceof BuildNotReady) return send(res, 'build_not_ready', { status: err.status });
  if (err instanceof BuildIncomplete) return send(res, 'build_incomplete', { missing: err.missing });

  console.error(err);
  send(res, 'internal_error');
};
