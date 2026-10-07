import { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger';

/** Structured access log. Deliberately never logs headers (Authorization) or bodies (PII). */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info('request', {
      requestId: res.locals.requestId,
      method: req.method,
      path: req.baseUrl + req.path,
      status: res.statusCode,
      latencyMs: Math.round(latencyMs * 100) / 100,
      errorCode: res.locals.errorCode,
      tenantId: req.ctx?.tenantId,
      organizationId: req.ctx?.organizationId,
      actorUserId: req.ctx?.actorUserId,
    });
  });
  next();
}
