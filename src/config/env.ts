import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const schema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(4020),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_SSL: bool,
    DATABASE_SSL_CA: z.string().optional(),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
    MAX_PAGE_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).default(10000),
    IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().min(1).default(24),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
    GLOBAL_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(600),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),

    // Authentication. "jwt": signed tokens carry tenant/org/actor/roles (recommended, required in production).
    // "static": shared BRR token + trusted X-* headers (local/dev or a locked-down internal network only).
    AUTH_MODE: z.enum(['jwt', 'static']).optional(),
    ALLOW_INSECURE_STATIC_AUTH: bool,
    BRR_TOKEN: z.string().min(16, 'BRR_TOKEN must be at least 16 characters').optional(),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
    JWT_PUBLIC_KEY: z.string().optional(),
    JWT_ISSUER: z.string().min(1).optional(),
    JWT_AUDIENCE: z.string().min(1).optional(),
  })
  .superRefine((e, ctx) => {
    const mode = e.AUTH_MODE ?? (e.NODE_ENV === 'production' ? 'jwt' : 'static');
    if (mode === 'static') {
      if (!e.BRR_TOKEN) ctx.addIssue({ code: 'custom', path: ['BRR_TOKEN'], message: 'BRR_TOKEN is required when AUTH_MODE=static' });
      if (e.NODE_ENV === 'production' && !e.ALLOW_INSECURE_STATIC_AUTH) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_MODE'],
          message: 'static auth is disabled in production; use AUTH_MODE=jwt (or set ALLOW_INSECURE_STATIC_AUTH=true behind a trusted gateway)',
        });
      }
    } else {
      if (!e.JWT_SECRET && !e.JWT_PUBLIC_KEY) {
        ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'JWT_SECRET (HS256) or JWT_PUBLIC_KEY (RS256/ES256) is required when AUTH_MODE=jwt' });
      }
      if (!e.JWT_ISSUER) ctx.addIssue({ code: 'custom', path: ['JWT_ISSUER'], message: 'JWT_ISSUER is required when AUTH_MODE=jwt' });
      if (!e.JWT_AUDIENCE) ctx.addIssue({ code: 'custom', path: ['JWT_AUDIENCE'], message: 'JWT_AUDIENCE is required when AUTH_MODE=jwt' });
    }
  })
  .transform((e) => ({
    ...e,
    AUTH_MODE: (e.AUTH_MODE ?? (e.NODE_ENV === 'production' ? 'jwt' : 'static')) as 'jwt' | 'static',
  }));

export type Env = z.output<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Only variable names and messages are printed - never values (secrets).
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  return parsed.data;
}

export const env: Env = load();
