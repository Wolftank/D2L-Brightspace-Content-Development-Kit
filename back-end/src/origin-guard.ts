import type { RequestHandler } from 'express';
import { Forbidden } from './errors.js';

export interface OriginGuardSettings {
  /** The origin the app is opened at. */
  appOrigin: string;
  /** When set, every API request must carry this token in `X-CDK-Token`. */
  launchToken?: string;
}

/** The names the back end answers to on this computer. */
const LOOPBACK_HOSTNAMES = ['127.0.0.1', 'localhost', '[::1]'];

/**
 * Rejects API requests that don't come from the CDK window with `Forbidden`:
 * a `Host` other than the back end's loopback names or the app origin's host,
 * which stops DNS rebinding; an `Origin` other than the app origin, which
 * covers other websites and build previews; and, when a launch token is set,
 * a request without it.
 */
export function originGuard(settings: OriginGuardSettings): RequestHandler {
  const appOrigin = new URL(settings.appOrigin);
  const hostnames = new Set([...LOOPBACK_HOSTNAMES, appOrigin.hostname]);

  return (req, _res, next) => {
    const hostname = hostnameOf(req.headers.host);
    const allowed =
      hostname !== undefined &&
      hostnames.has(hostname) &&
      (req.headers.origin === undefined || req.headers.origin === appOrigin.origin) &&
      (settings.launchToken === undefined || req.headers['x-cdk-token'] === settings.launchToken);
    next(allowed ? undefined : new Forbidden());
  };
}

function hostnameOf(host: string | undefined): string | undefined {
  if (!host) return undefined;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return undefined;
  }
}
