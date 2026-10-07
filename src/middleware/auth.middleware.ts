import { createHash, timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { isValidBigIntId } from '../utils/bigint';
import { AppError } from '../utils/errors';

export interface VerifiedClaims {
  tenantId: string;
  organizationId: string;
  softwareId: string;
  actorUserId: string;
  roles: string[];
}

const sha256 = (v: string) => createHash('sha256').update(v).digest();
const expectedStatic = env.BRR_TOKEN ? sha256(env.BRR_TOKEN) : undefined;

const publicKey = env.JWT_PUBLIC_KEY?.replace(/\\n/g, '\n');
const verifyKey = publicKey ?? (env.JWT_SECRET as string | undefined);
// Algorithms are pinned explicitly so a token can never choose its own (alg confusion / "none").
const algorithms: jwt.Algorithm[] = publicKey ? ['RS256', 'ES256'] : ['HS256'];

const invalid = () => new AppError(401, 'INVALID_BEARER_TOKEN', 'Bearer token is invalid or expired');

function verifyJwt(token: string): VerifiedClaims {
  let payload: jwt.JwtPayload;
  try {
    const decoded = jwt.verify(token, verifyKey as string, {
      algorithms,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      clockTolerance: 5,
    });
    if (typeof decoded === 'string') throw invalid();
    payload = decoded;
  } catch {
    throw invalid();
  }

  // Short-lived tokens only: a token without an expiry is rejected.
  if (typeof payload.exp !== 'number') throw invalid();

  const { sub, tenant_id, organization_id, software_id, roles } = payload as Record<string, unknown>;
  if (
    !isValidBigIntId(sub) ||
    !isValidBigIntId(tenant_id) ||
    !isValidBigIntId(organization_id) ||
    !isValidBigIntId(software_id) ||
    !Array.isArray(roles) ||
    !roles.every((r) => typeof r === 'string')
  ) {
    throw invalid();
  }
  return {
    actorUserId: sub,
    tenantId: tenant_id,
    organizationId: organization_id,
    softwareId: software_id,
    roles: roles as string[],
  };
}

/**
 * Authenticates the caller.
 *  - jwt:    verifies a signed token; tenant/org/software/actor/roles come from its claims.
 *  - static: constant-time comparison against the shared BRR token (identity then comes from trusted headers).
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (!header) {
    return next(new AppError(401, 'AUTHORIZATION_REQUIRED', 'Authorization header is required'));
  }
  const match = /^Bearer ([^\s]+)$/.exec(header);
  const token = match?.[1];
  if (!token) return next(invalid());

  try {
    if (env.AUTH_MODE === 'jwt') {
      res.locals.claims = verifyJwt(token);
    } else if (!expectedStatic || !timingSafeEqual(sha256(token), expectedStatic)) {
      return next(invalid());
    }
  } catch (err) {
    return next(err);
  }
  next();
}
