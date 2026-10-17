import type { ApiErrorBody, NextStep } from '@cdk/contract';
import type { ErrorRequestHandler, Response } from 'express';
import { ZodError } from 'zod';

/** The requested project or route does not exist, or the project is not owned by the caller. */
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

/** The requested build does not exist, is not owned by the caller, or has no such preview file. */
export class BuildNotFound extends Error {
  constructor() {
    super('Build not found');
    this.name = 'BuildNotFound';
  }
}

/** A download was requested for a build that is still being checked. */
export class BuildNotReady extends Error {
  constructor() {
    super('Only a ready build can be downloaded; this build is still being checked');
    this.name = 'BuildNotReady';
  }
}

/** A download was requested for a build that failed. */
export class BuildFailed extends Error {
  constructor() {
    super('A failed build cannot be downloaded');
    this.name = 'BuildFailed';
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
  not_found: { status: 404, message: "This project doesn't exist.", nextStep: 'new_project' },
  build_not_found: { status: 404, message: "This build doesn't exist.", nextStep: 'send_again' },
  turn_active: { status: 409, message: 'A request is already running for this project.', nextStep: 'wait' },
  build_not_ready: { status: 409, message: "This build isn't ready to download.", nextStep: 'try_later' },
  build_failed: { status: 409, message: "This build failed, so it can't be downloaded.", nextStep: 'ask_for_fix' },
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
  if (err instanceof BuildNotFound) return send(res, 'build_not_found');
  if (err instanceof TurnActive) return send(res, 'turn_active', { turnId: err.turnId });
  if (err instanceof BuildNotReady) return send(res, 'build_not_ready');
  if (err instanceof BuildFailed) return send(res, 'build_failed');
  if (err instanceof BuildIncomplete) return send(res, 'build_incomplete', { missing: err.missing });

  console.error(err);
  send(res, 'internal_error');
};
