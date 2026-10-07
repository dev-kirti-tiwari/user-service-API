import { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { sendError } from '../utils/response';

export function notFound(_req: Request, res: Response): void {
  sendError(res, 404, 'ROUTE_NOT_FOUND', 'Route not found');
}

// PostgreSQL connection-class failures and statement timeouts should surface as 503, not a generic 500.
const DB_UNAVAILABLE_CODES = new Set(['57P01', '57P02', '57P03', '53300', '57014', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND']);

interface HttpishError {
  type?: string;
  status?: number;
  code?: string;
  message?: string;
}

/** Deterministic error envelope. Never leaks SQL, hostnames, stack traces or secrets. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;

  if (err instanceof AppError) {
    return sendError(res, err.status, err.code, err.message, err.details);
  }

  const e = (err ?? {}) as HttpishError;

  // body-parser failures (malformed JSON, oversized payload, bad charset)
  if (e.type === 'entity.parse.failed') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request body is not valid JSON');
  }
  if (e.type === 'entity.too.large') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request body is too large');
  }
  if (e.type && e.type.startsWith('encoding.') ) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Unsupported request encoding');
  }

  if (e.code && DB_UNAVAILABLE_CODES.has(e.code)) {
    logger.error('database unavailable', { requestId: res.locals.requestId, dbCode: e.code });
    return sendError(res, 503, 'SERVICE_NOT_READY', 'Service temporarily unavailable');
  }

  logger.error('unhandled error', {
    requestId: res.locals.requestId,
    method: req.method,
    path: req.path,
    errorName: err instanceof Error ? err.name : typeof err,
    errorMessage: err instanceof Error ? err.message : undefined,
    stack: err instanceof Error ? err.stack : undefined,
  });
  sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}
