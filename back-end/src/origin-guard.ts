import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { Forbidden } from './errors.js';

export interface OriginGuardSettings {
  /** The origin the app is opened at. */
  appOrigin: string;
  /** When set, every API request must carry this token in the `LAUNCH_COOKIE` cookie. */
  launchToken?: string;
}

/** The cookie the CDK window carries the launch token in. The desktop app sets it on its window. */
export const LAUNCH_COOKIE = 'cdk_launch';

/** The names the back end answers to on this computer. */
const LOOPBACK_HOSTNAMES = ['127.0.0.1', 'localhost', '[::1]'];

/**
 * Rejects API requests that don't come from the CDK window with `Forbidden`:
 * a `Host` other than the back end's loopback names or the app origin's host,
 * which stops DNS rebinding; an `Origin` other than the app origin, which
 * covers other websites and build previews; and, when a launch token is set,
 * a request without it in the `LAUNCH_COOKIE` cookie, which covers other
 * programs on the computer.
 */
export function originGuard(settings: OriginGuardSettings): RequestHandler {
  const appOrigin = new URL(settings.appOrigin);
  const hostnames = new Set([...LOOPBACK_HOSTNAMES, appOrigin.hostname]);
  const { launchToken } = settings;

  return (req, _res, next) => {
    const hostname = hostnameOf(req.headers.host);
    const allowed =
      hostname !== undefined &&
      hostnames.has(hostname) &&
      (req.headers.origin === undefined || req.headers.origin === appOrigin.origin) &&
      (launchToken === undefined || isToken(cookieValue(req.headers.cookie, LAUNCH_COOKIE), launchToken));
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

/** The value of the cookie `name` in a `Cookie` header. */
function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const pair of header?.split(';') ?? []) {
    const separator = pair.indexOf('=');
    if (separator > 0 && pair.slice(0, separator).trim() === name) return pair.slice(separator + 1).trim();
  }
  return undefined;
}

/** Whether `value` is `token`, compared in constant time. */
function isToken(value: string | undefined, token: string): boolean {
  const given = Buffer.from(value ?? '');
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
