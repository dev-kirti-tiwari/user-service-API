import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { sendError } from '../utils/response';

/** Applied to sensitive write endpoints (create / status / delete). Keyed per tenant+org+actor. */
export const writeRateLimit = rateLimit({
  windowMs: 60_000,
  limit: env.RATE_LIMIT_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  // Always runs after securityContext, so req.ctx is set.
  keyGenerator: (req) => `${req.ctx.tenantId}:${req.ctx.organizationId}:${req.ctx.actorUserId}`,
  handler: (_req, res) => sendError(res, 429, 'RATE_LIMITED', 'Too many requests, please retry later'),
});
