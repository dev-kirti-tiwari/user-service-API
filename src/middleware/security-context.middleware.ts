import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { isValidBigIntId } from '../utils/bigint';
import { AppError, ErrorDetail } from '../utils/errors';
import type { VerifiedClaims } from './auth.middleware';

const HEADERS = [
  ['X-Tenant-Id', 'tenantId'],
  ['X-Organization-Id', 'organizationId'],
  ['X-Software-Id', 'softwareId'],
  ['X-User-Id', 'actorUserId'],
] as const;

/**
 * Builds the trusted security context.
 *  - jwt mode:    from the verified token claims. Client-supplied X-* identity headers are ignored entirely.
 *  - static mode: from the X-* headers (set by a trusted gateway). Each must be a positive BIGINT decimal string.
 * The request body is never a source of tenant / organization / actor.
 */
export function securityContext(req: Request, res: Response, next: NextFunction): void {
  if (env.AUTH_MODE === 'jwt') {
    const claims = res.locals.claims as VerifiedClaims | undefined;
    if (!claims) return next(new AppError(401, 'INVALID_BEARER_TOKEN', 'Bearer token is invalid or expired'));
    req.ctx = { ...claims, requestId: res.locals.requestId };
    return next();
  }

  const values: Record<string, string> = {};
  const problems: ErrorDetail[] = [];

  for (const [header, key] of HEADERS) {
    const raw = req.header(header);
    if (raw === undefined || raw === '') {
      problems.push({ field: header, message: `${header} header is required` });
    } else if (!isValidBigIntId(raw)) {
      problems.push({ field: header, message: `${header} must be a positive integer string (max 9223372036854775807)` });
    } else {
      values[key] = raw;
    }
  }

  if (problems.length) {
    return next(AppError.validation('Missing or invalid security context headers', problems));
  }

  req.ctx = {
    tenantId: values.tenantId as string,
    organizationId: values.organizationId as string,
    softwareId: values.softwareId as string,
    actorUserId: values.actorUserId as string,
    roles: ['service'],
    requestId: res.locals.requestId,
  };
  next();
}
