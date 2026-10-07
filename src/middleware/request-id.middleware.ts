import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

const VALID_REQUEST_ID = /^[A-Za-z0-9_.\-]{1,128}$/;

/** Accepts a well-formed incoming X-Request-Id or generates one; always echoes it back. */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : `req_${randomUUID()}`;
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
