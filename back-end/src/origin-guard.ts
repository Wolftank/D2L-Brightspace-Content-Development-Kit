import type { ApiErrorBody } from '@cdk/contract';
import type { RequestHandler } from 'express';

export interface OriginGuardSettings {
  appOrigin: string;
  previewOrigin: string;
  launchToken?: string;
}

const FORBIDDEN: ApiErrorBody = { error: { code: 'forbidden', message: 'Forbidden' } };

/**
 * Rejects API requests that don't come from the CDK window.
 *
 * - A request with a foreign `Origin` header gets 403.
 * - When a launch token is configured (packaged app), a request without it
 *   gets 403.
 * - A request from the preview origin gets 403.
 */
export function originGuard(settings: OriginGuardSettings): RequestHandler {
  const allowedOrigin = new URL(settings.appOrigin).origin;
  const previewHost = new URL(settings.previewOrigin).host;

  return (req, res, next) => {
    if (settings.launchToken) {
      if (req.headers['x-cdk-token'] !== settings.launchToken) {
        res.status(403).json(FORBIDDEN);
        return;
      }
    }

    const origin = req.headers.origin;
    if (origin) {
      if (origin !== allowedOrigin) {
        res.status(403).json(FORBIDDEN);
        return;
      }
      next();
      return;
    }

    if (req.headers.host?.toLowerCase() === previewHost) {
      res.status(403).json(FORBIDDEN);
      return;
    }

    next();
  };
}
