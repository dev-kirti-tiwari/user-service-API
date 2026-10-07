import { readdirSync } from 'fs';
import path from 'path';
import { Router } from 'express';
import { pool } from '../config/database';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { sendError, sendSuccess } from '../utils/response';

export const healthRoutes = Router();

/** Liveness: cheap, no dependency checks. */
healthRoutes.get('/health', (_req, res) => {
  sendSuccess(res, 200, 'Service is alive', { status: 'ok' });
});

/** Readiness: required config, PostgreSQL connectivity and applied migrations. */
healthRoutes.get('/ready', async (_req, res) => {
  const checks: Record<string, 'ok' | 'fail'> = { config: 'ok', database: 'fail', migrations: 'fail' };
  try {
    if (!env.BRR_TOKEN || !env.DATABASE_URL) checks.config = 'fail';
    await pool.query('SELECT 1');
    checks.database = 'ok';

    const dir = path.resolve(process.cwd(), 'migrations');
    const expected = readdirSync(dir).filter((f) => f.endsWith('.sql'));
    const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    if (expected.every((f) => applied.has(f))) checks.migrations = 'ok';
  } catch (err) {
    logger.warn('readiness check failed', { requestId: res.locals.requestId, errorMessage: (err as Error).message });
  }

  if (Object.values(checks).every((v) => v === 'ok')) {
    return sendSuccess(res, 200, 'Service is ready', { status: 'ready', checks });
  }
  sendError(res, 503, 'SERVICE_NOT_READY', 'Service is not ready', Object.entries(checks)
    .filter(([, v]) => v === 'fail')
    .map(([k]) => ({ field: k, message: `${k} check failed` })));
});
