import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const SECRET = 'jwt-test-secret-0123456789abcdef0123456789';
const ISSUER = 'triostack-auth';
const AUDIENCE = 'triostack-user-service';

type App = import('express').Express;
let app: App;
let pool: import('pg').Pool;

interface Who {
  tenant?: string;
  org?: string;
  user?: string;
  roles?: string[];
}
const ADMIN: Who = { user: '900001', roles: ['admin'] };
const MANAGER: Who = { user: '900002', roles: ['manager'] };
const MEMBER: Who = { user: '900003', roles: ['member'] };

function token(who: Who, opts: jwt.SignOptions = {}, claims: Record<string, unknown> = {}, secret = SECRET) {
  return jwt.sign(
    {
      tenant_id: who.tenant ?? '1001',
      organization_id: who.org ?? '5001',
      software_id: '10',
      roles: who.roles ?? [],
      ...claims,
    },
    secret,
    { algorithm: 'HS256', issuer: ISSUER, audience: AUDIENCE, subject: who.user ?? '900001', expiresIn: 600, ...opts },
  );
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const as = (who: Who) => bearer(token(who));
let seq = 0;
const email = () => `rbac${Date.now()}${seq++}@company.com`;

async function seedUser(who: Who = ADMIN, body: object = {}) {
  const res = await request(app).post('/api/v1/users').set(as(who)).send({ firstName: 'Seed', email: email(), ...body });
  expect(res.status).toBe(201);
  return res.body.data as { id: string };
}

beforeAll(async () => {
  Object.assign(process.env, {
    AUTH_MODE: 'jwt',
    JWT_SECRET: SECRET,
    JWT_ISSUER: ISSUER,
    JWT_AUDIENCE: AUDIENCE,
  });
  const { runMigrations } = await import('../scripts/migrate.js');
  await runMigrations();
  app = (await import('../src/app.js')).createApp();
  pool = (await import('../src/config/database.js')).pool;
});

afterAll(async () => {
  await pool.end();
});

describe('JWT authentication', () => {
  it('accepts a valid token and takes scope/actor from claims', async () => {
    const u = await seedUser();
    const res = await request(app).get(`/api/v1/users/${u.id}`).set(as(ADMIN));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ tenantId: '1001', organizationId: '5001', createdBy: '900001' });
  });

  it('ignores client-supplied X-* identity headers (token is authoritative)', async () => {
    const u = await seedUser();
    const res = await request(app)
      .get(`/api/v1/users/${u.id}`)
      .set(as(ADMIN))
      .set({ 'X-Tenant-Id': '9999', 'X-Organization-Id': '9999', 'X-User-Id': '1' });
    expect(res.status).toBe(200); // still tenant 1001 / org 5001
    const forged = await request(app).get('/api/v1/users/me').set(as({ ...ADMIN, user: u.id })).set({ 'X-User-Id': '1' });
    expect(forged.body.data.id).toBe(u.id);
  });

  it('works without any X-* headers at all', async () => {
    expect((await request(app).get('/api/v1/users').set(as(ADMIN))).status).toBe(200);
  });

  it('rejects missing, malformed and wrong-secret tokens', async () => {
    expect((await request(app).get('/api/v1/users')).body.error.code).toBe('AUTHORIZATION_REQUIRED');
    for (const t of ['garbage', 'a.b.c', token(ADMIN, {}, {}, 'a-completely-different-secret-0123456789')]) {
      const res = await request(app).get('/api/v1/users').set(bearer(t));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_BEARER_TOKEN');
    }
  });

  it('rejects expired tokens, wrong issuer and wrong audience', async () => {
    for (const t of [
      token(ADMIN, { expiresIn: -60 }),
      token(ADMIN, { issuer: 'someone-else' }),
      token(ADMIN, { audience: 'another-service' }),
    ]) {
      expect((await request(app).get('/api/v1/users').set(bearer(t))).status).toBe(401);
    }
  });

  it('rejects tokens with no expiry, "none" algorithm, or an unexpected algorithm', async () => {
    const noExp = jwt.sign({ tenant_id: '1001', organization_id: '5001', software_id: '10', roles: ['admin'] }, SECRET, {
      algorithm: 'HS256', issuer: ISSUER, audience: AUDIENCE, subject: '900001',
    });
    const none = jwt.sign({ tenant_id: '1001', organization_id: '5001', software_id: '10', roles: ['admin'] }, '', {
      algorithm: 'none', issuer: ISSUER, audience: AUDIENCE, subject: '900001', expiresIn: 600,
    });
    const hs512 = token(ADMIN, { algorithm: 'HS512' });
    for (const t of [noExp, none, hs512]) {
      const res = await request(app).get('/api/v1/users').set(bearer(t));
      expect(res.status).toBe(401);
    }
  });

  it('rejects validly-signed tokens with missing or malformed claims', async () => {
    for (const t of [
      token(ADMIN, {}, { tenant_id: 'abc' }),
      token(ADMIN, {}, { organization_id: undefined }),
      token(ADMIN, {}, { roles: 'admin' }),
      token(ADMIN, {}, { roles: [1] }),
      token(ADMIN, { subject: 'not-a-number' }),
    ]) {
      expect((await request(app).get('/api/v1/users').set(bearer(t))).status).toBe(401);
    }
  });

  it('keeps tenant/org isolation under JWT', async () => {
    const u = await seedUser();
    for (const other of [{ ...ADMIN, org: '5002' }, { ...ADMIN, tenant: '2002' }]) {
      expect((await request(app).get(`/api/v1/users/${u.id}`).set(as(other))).status).toBe(404);
      expect((await request(app).delete(`/api/v1/users/${u.id}`).set(as(other))).status).toBe(404);
    }
  });
});

describe('role-based permissions', () => {
  it('admin can do everything', async () => {
    const u = await seedUser(ADMIN);
    expect((await request(app).patch(`/api/v1/users/${u.id}`).set(as(ADMIN)).send({ roleId: '7', phone: '9999999999' })).status).toBe(200);
    expect((await request(app).patch(`/api/v1/users/${u.id}/status`).set(as(ADMIN)).send({ status: 'suspended' })).status).toBe(200);
    expect((await request(app).delete(`/api/v1/users/${u.id}`).set(as(ADMIN))).status).toBe(200);
  });

  it('manager can create/read/update but not assign roles, change status or delete', async () => {
    const u = await seedUser(MANAGER);
    expect((await request(app).get(`/api/v1/users/${u.id}`).set(as(MANAGER))).status).toBe(200);
    expect((await request(app).patch(`/api/v1/users/${u.id}`).set(as(MANAGER)).send({ designation: 'Lead', departmentId: '3' })).status).toBe(200);
    for (const res of [
      await request(app).patch(`/api/v1/users/${u.id}`).set(as(MANAGER)).send({ roleId: '9' }),
      await request(app).patch(`/api/v1/users/${u.id}/status`).set(as(MANAGER)).send({ status: 'inactive' }),
      await request(app).delete(`/api/v1/users/${u.id}`).set(as(MANAGER)),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('member is read-only for others', async () => {
    const u = await seedUser(ADMIN);
    expect((await request(app).get('/api/v1/users').set(as(MEMBER))).status).toBe(200);
    expect((await request(app).get(`/api/v1/users/${u.id}`).set(as(MEMBER))).status).toBe(200);
    for (const res of [
      await request(app).post('/api/v1/users').set(as(MEMBER)).send({ firstName: 'Nope' }),
      await request(app).patch(`/api/v1/users/${u.id}`).set(as(MEMBER)).send({ designation: 'x' }),
      await request(app).patch(`/api/v1/users/${u.id}/status`).set(as(MEMBER)).send({ status: 'inactive' }),
      await request(app).delete(`/api/v1/users/${u.id}`).set(as(MEMBER)),
    ]) {
      expect(res.status).toBe(403);
    }
  });

  it('a member may edit only self-service fields on their own record', async () => {
    const me = await seedUser(ADMIN, { firstName: 'Self' });
    const self: Who = { ...MEMBER, user: me.id };
    const ok = await request(app).patch(`/api/v1/users/${me.id}`).set(as(self)).send({ phone: '9876500000', designation: 'Dev' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.updatedBy).toBe(me.id);
    for (const body of [{ email: 'new@company.com' }, { roleId: '1' }, { departmentId: '1' }]) {
      expect((await request(app).patch(`/api/v1/users/${me.id}`).set(as(self)).send(body)).status).toBe(403);
    }
  });

  it('any authenticated actor can read /me, even with no roles', async () => {
    const me = await seedUser(ADMIN, { firstName: 'NoRole' });
    const res = await request(app).get('/api/v1/users/me').set(as({ user: me.id, roles: [] }));
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(me.id);
    // ...but a role-less actor cannot list users
    expect((await request(app).get('/api/v1/users').set(as({ user: me.id, roles: [] }))).status).toBe(403);
  });

  it('unknown roles grant nothing', async () => {
    expect((await request(app).get('/api/v1/users').set(as({ ...ADMIN, roles: ['superuser'] }))).status).toBe(403);
  });

  it('permission failures do not reveal whether a target exists', async () => {
    const real = await request(app).patch('/api/v1/users/1/status').set(as(MEMBER)).send({ status: 'inactive' });
    const ghost = await request(app).patch('/api/v1/users/999999999999/status').set(as(MEMBER)).send({ status: 'inactive' });
    expect(real.status).toBe(403);
    expect(ghost.status).toBe(403);
  });
});

describe('production safety / hardening', () => {
  const saved = { ...process.env };
  const restore = () => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  };

  it('refuses to start in production with static auth unless explicitly overridden', async () => {
    vi.resetModules();
    Object.assign(process.env, { NODE_ENV: 'production', AUTH_MODE: 'static', BRR_TOKEN: 'x'.repeat(32) });
    delete process.env.ALLOW_INSECURE_STATIC_AUTH;
    await expect(import('../src/config/env.js')).rejects.toThrow(/static auth is disabled in production/);
    restore();
  });

  it('defaults to jwt in production and requires issuer/audience/key', async () => {
    vi.resetModules();
    Object.assign(process.env, { NODE_ENV: 'production' });
    delete process.env.AUTH_MODE;
    delete process.env.JWT_ISSUER;
    delete process.env.JWT_AUDIENCE;
    delete process.env.JWT_SECRET;
    await expect(import('../src/config/env.js')).rejects.toThrow(/JWT_ISSUER is required/);
    restore();
  });

  it('rejects a short JWT_SECRET and never echoes secret values in the error', async () => {
    vi.resetModules();
    Object.assign(process.env, { JWT_SECRET: 'tooshort-but-secret' });
    const err = await import('../src/config/env.js').then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/JWT_SECRET must be at least 32/);
    expect(err?.message).not.toContain('tooshort-but-secret');
    restore();
  });

  it('applies a global per-IP rate limit before authentication', async () => {
    vi.resetModules();
    Object.assign(process.env, { GLOBAL_RATE_LIMIT_PER_MINUTE: '3' });
    const limited = (await import('../src/app.js')).createApp();
    const limitedPool = (await import('../src/config/database.js')).pool;
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await request(limited).get('/api/v1/users')).status);
    expect(codes).toEqual([401, 401, 401, 429, 429]);
    const health = await request(limited).get('/health'); // probes are never throttled
    expect(health.status).toBe(200);
    await limitedPool.end();
    restore();
  });

  it('sets security headers and does not advertise Express', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });
});
