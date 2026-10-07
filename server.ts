import { createApp } from './src/app';
import { pool } from './src/config/database';
import { env } from './src/config/env';
import { idempotencyRepository } from './src/repositories/idempotency.repository';
import { logger } from './src/utils/logger';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info('user-service listening', { port: env.PORT, nodeEnv: env.NODE_ENV });
});

server.requestTimeout = env.REQUEST_TIMEOUT_MS;
server.headersTimeout = Math.min(env.REQUEST_TIMEOUT_MS, 60_000);

// Housekeeping: drop idempotency records past their retention window (hourly; does not keep the process alive).
const purgeTimer = setInterval(() => {
  pool
    .connect()
    .then(async (client) => {
      try {
        const n = await idempotencyRepository.purgeExpired(client, env.IDEMPOTENCY_TTL_HOURS);
        if (n > 0) logger.info('idempotency purge', { removed: n });
      } finally {
        client.release();
      }
    })
    .catch((err) => logger.warn('idempotency purge failed', { errorMessage: (err as Error).message }));
}, 3_600_000);
purgeTimer.unref();

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal });
  server.close(async () => {
    await pool.end().catch(() => undefined);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', { reason: reason instanceof Error ? reason.message : String(reason) });
});
