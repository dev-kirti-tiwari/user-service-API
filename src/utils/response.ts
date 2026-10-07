import { Response } from 'express';
import { ErrorCode, ErrorDetail } from './errors';

export function sendSuccess(
  res: Response,
  status: number,
  message: string,
  data: unknown,
  meta?: Record<string, unknown>,
): void {
  res.status(status).json({
    success: true,
    message,
    data,
    ...(meta ? { meta } : {}),
    requestId: res.locals.requestId,
  });
}

export function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details: ErrorDetail[] = [],
): void {
  res.locals.errorCode = code;
  res.status(status).json({
    success: false,
    error: { code, message, details },
    requestId: res.locals.requestId,
  });
}
