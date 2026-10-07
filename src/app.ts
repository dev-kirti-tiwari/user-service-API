import express, { Express } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { errorHandler, notFound } from './middleware/error.middleware';
import { requestId } from './middleware/request-id.middleware';
import { requestLogger } from './middleware/request-logger.middleware';
import { healthRoutes } from './routes/health.routes';
import { userRoutes } from './routes/user.routes';
import { sendError } from './utils/response';

/** Per-IP ceiling applied before authentication, so unauthenticated floods / token guessing are throttled. */
const globalRateLimit = rateLimit({
  windowMs: 60_000,
  limit: env.GLOBAL_RATE_LIMIT_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => sendError(res, 429, 'RATE_LIMITED', 'Too many requests, please retry later'),
});

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  // Number of reverse-proxy hops in front of the service (0 = none). Needed for correct client IPs.
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestId);
  app.use(helmet());
  app.use(requestLogger);

  // Probes stay unthrottled so orchestrators are never rate limited.
  app.use(healthRoutes);

  app.use(globalRateLimit);
  app.use(express.json({ limit: '100kb', strict: true }));
  app.use('/api/v1/users', userRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
