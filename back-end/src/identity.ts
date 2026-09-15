import type { RequestHandler } from 'express';
import type { Deps } from './deps.js';

/**
 * Sets `req.user` to the local-mode stub user. In hosted mode this is
 * replaced by a driver that reads the OIDC login cookie, behind the same
 * `req.user`.
 */
export function identity(deps: Deps): RequestHandler {
  return (req, _res, next) => {
    req.user = deps.users.ensureLocalUser();
    next();
  };
}
