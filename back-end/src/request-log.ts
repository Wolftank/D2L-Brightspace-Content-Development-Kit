import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { pinoHttp } from 'pino-http';
import { log } from './log.js';

/** The response header that carries the request's ID. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/** The request's method, path without its query, status, and duration in milliseconds. */
function requestRecord(req: Request, res: Response, responseTime: number): Record<string, unknown> {
  return { method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, responseTime };
}

/**
 * Gives every request a new ID, sent back in `X-Request-Id`, and a logger
 * (`req.log`) whose records carry it as `reqId`. Logs one record per
 * response from `requestRecord`: at `error` for a 5xx, `warn` for a 4xx, and
 * `info` otherwise. Registered first, so every response carries the header.
 */
export function requestLog(): RequestHandler {
  return pinoHttp<Request, Response>({
    logger: log,
    genReqId: (_req, res) => {
      const id = randomUUID();
      res.setHeader(REQUEST_ID_HEADER, id);
      return id;
    },
    quietReqLogger: true,
    quietResLogger: true,
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    customSuccessObject: (req, res, val: { responseTime: number }) => requestRecord(req, res, val.responseTime),
    customErrorObject: (req, res, _err, val: { responseTime: number }) => requestRecord(req, res, val.responseTime),
    customSuccessMessage: () => 'Request completed',
    customErrorMessage: () => 'Request completed',
  });
}
