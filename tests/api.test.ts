import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../scripts/migrate';
import { createApp } from '../src/app';
import { pool } from '../src/config/database';

const TOKEN = process.env.BRR_TOKEN as string;
const app = createApp();

interface Ctx {
  tenant?: string;
  org?: string;
  actor?: string;
}
const A: Ctx = { tenant: '1001', org: '5001', actor: '501200' };
const OTHER_ORG: Ctx = { tenant: '1001', org: '5002', actor: '501200' };
const OTHER_TENANT: Ctx = { tenant: '2002', org: '5001', actor: '501200' };

function headers(c: Ctx = A, extra: Record<string, string> = {}) {
  const h: Record<string, string> = { Authorization: `Bearer ${TOKEN}`, 'X-Software-Id': '10', ...extra };
  if (c.tenant) h['X-Tenant-Id'] = c.tenant;
  if (c.org) h['X-Organization-Id'] = c.org;
  if (c.actor) h['X-User-Id'] = c.actor;
  return h;
}

const api = {
  create: (body: object, c: Ctx = A, extra: Record<string, string> = {}) =>
    request(app).post('/api/v1/users').set(headers(c, extra)).send(body),
  get: (id: string, c: Ctx = A) => request(app).get(`/api/v1/users/${id}`).set(headers(c)),
  list: (qs = '', c: Ctx = A) => request(app).get(`/api/v1/users${qs}`).set(headers(c)),
  patch: (id: string, body: object, c: Ctx = A) => request(app).patch(`/api/v1/users/${id}`).set(headers(c)).send(body),
  status: (id: string, body: object, c: Ctx = A) =>
    request(app).patch(`/api/v1/users/${id}/status`).set(headers(c)).send(body),
  del: (id: string, c: Ctx = A) => request(app).delete(`/api/v1/users/${id}`).set(headers(c)),
};

let seq = 0;
const uniqueEmail = () => `user${Date.now()}${seq++}@company.com`;

async function makeUser(overrides: object = {}, c: Ctx = A) {
  const res = await api.create({ firstName: 'Aman', lastName: 'Sharma', email: uniqueEmail(), ...overrides }, c);
  expect(res.status).toBe(201);
  return res.body.data as { id: string; [k: string]: any };
}

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  await pool.end();
});

describe('operational endpoints', () => {
  it('GET /health is public and returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.requestId).toBeTruthy();
  });

  it('GET /ready returns 200 when DB and migrations are ready', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.data.checks).toEqual({ config: 'ok', database: 'ok', migrations: 'ok' });
  });

  it('unknown routes return the standard 404 envelope', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});

describe('authentication and context', () => {
  it('missing token -> 401 AUTHORIZATION_REQUIRED', async () => {
    const res = await request(app).get('/api/v1/users').set({ 'X-Tenant-Id': '1', 'X-Organization-Id': '1', 'X-Software-Id': '1', 'X-User-Id': '1' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHORIZATION_REQUIRED');
  });

  it('invalid / malformed token -> 401 INVALID_BEARER_TOKEN', async () => {
    for (const auth of ['Bearer wrong-token', 'Basic abc', `Bearer ${TOKEN} extra`, 'Bearer']) {
      const res = await request(app).get('/api/v1/users').set({ ...headers(), Authorization: auth });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_BEARER_TOKEN');
    }
  });

  it('auth is checked before context validation', async () => {
    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(401);
  });

  it('missing or malformed context headers -> 400 VALIDATION_ERROR', async () => {
    for (const bad of [{ ...A, tenant: undefined }, { ...A, org: undefined }, { ...A, actor: undefined }, { ...A, tenant: 'abc' }, { ...A, org: '-1' }, { ...A, actor: '0' }]) {
      const res = await api.list('', bad);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const noSoftware = await request(app)
      .get('/api/v1/users')
      .set({ Authorization: `Bearer ${TOKEN}`, 'X-Tenant-Id': '1', 'X-Organization-Id': '1', 'X-User-Id': '1' });
    expect(noSoftware.status).toBe(400);
  });

  it('echoes a valid X-Request-Id and generates one otherwise', async () => {
    const a = await request(app).get('/health').set('X-Request-Id', 'req_abc-123');
    expect(a.headers['x-request-id']).toBe('req_abc-123');
    expect(a.body.requestId).toBe('req_abc-123');
    const b = await request(app).get('/health').set('X-Request-Id', 'bad id with spaces!');
    expect(b.headers['x-request-id']).toMatch(/^req_/);
  });
});

describe('create', () => {
  it('creates a user with scope + created_by injected server-side; ids are strings', async () => {
    const res = await api.create({ firstName: 'Aman', lastName: 'Sharma', email: 'Create.Test@Company.com', phone: '9876543210', roleId: '20', departmentId: '10', designation: 'Sales Executive' });
    expect(res.status).toBe(201);
    const u = res.body.data;
    expect(res.body).toMatchObject({ success: true, message: 'User created successfully' });
    expect(typeof u.id).toBe('string');
    expect(u).toMatchObject({
      tenantId: '1001',
      organizationId: '5001',
      createdBy: '501200',
      updatedBy: '501200',
      status: 'active',
      email: 'create.test@company.com',
      roleId: '20',
      departmentId: '10',
    });
  });

  it('rejects body attempts to override tenant/org/actor', async () => {
    const res = await api.create({ firstName: 'Evil', tenantId: '9999', organizationId: '9999', createdBy: '1' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('validates required fields and malformed JSON', async () => {
    expect((await api.create({ lastName: 'NoFirst' })).status).toBe(400);
    const bad = await request(app).post('/api/v1/users').set(headers()).set('Content-Type', 'application/json').send('{"firstName": ');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('duplicate active email in same scope -> 409 (case-insensitive); other org is allowed', async () => {
    const email = uniqueEmail();
    await makeUser({ email });
    const dup = await api.create({ firstName: 'Dup', email: email.toUpperCase() });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('USER_EMAIL_CONFLICT');
    const otherOrg = await api.create({ firstName: 'Ok', email }, OTHER_ORG);
    expect(otherOrg.status).toBe(201);
  });

  it('email can be reused after the previous holder is soft-deleted', async () => {
    const email = uniqueEmail();
    const u = await makeUser({ email });
    expect((await api.del(u.id)).status).toBe(200);
    expect((await api.create({ firstName: 'Again', email })).status).toBe(201);
  });
});

describe('idempotent create', () => {
  it('same key + same payload replays the original result without a second insert', async () => {
    const key = `idem-${Date.now()}-a`;
    const body = { firstName: 'Idem', email: uniqueEmail() };
    const first = await api.create(body, A, { 'Idempotency-Key': key });
    const second = await api.create({ email: body.email, firstName: 'Idem' }, A, { 'Idempotency-Key': key }); // key order differs
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.data.id).toBe(first.body.data.id);
    const { rows } = await pool.query('SELECT COUNT(*)::INT AS n FROM users WHERE email = $1', [body.email]);
    expect(rows[0].n).toBe(1);
  });

  it('same key + different payload -> 409 IDEMPOTENCY_CONFLICT', async () => {
    const key = `idem-${Date.now()}-b`;
    await api.create({ firstName: 'One', email: uniqueEmail() }, A, { 'Idempotency-Key': key });
    const res = await api.create({ firstName: 'Two', email: uniqueEmail() }, A, { 'Idempotency-Key': key });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('keys are scoped per tenant/org', async () => {
    const key = `idem-${Date.now()}-c`;
    const a = await api.create({ firstName: 'Same' }, A, { 'Idempotency-Key': key });
    const b = await api.create({ firstName: 'Same' }, OTHER_ORG, { 'Idempotency-Key': key });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers['idempotent-replayed']).toBeUndefined();
    expect(b.body.data.id).not.toBe(a.body.data.id);
  });

  it('concurrent requests with the same key create exactly one user', async () => {
    const key = `idem-${Date.now()}-d`;
    const body = { firstName: 'Race', email: uniqueEmail() };
    const results = await Promise.all(Array.from({ length: 6 }, () => api.create(body, A, { 'Idempotency-Key': key })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
  });

  it('a failed create (email conflict) does not poison the key', async () => {
    const taken = uniqueEmail();
    await makeUser({ email: taken });
    const key = `idem-${Date.now()}-e`;
    expect((await api.create({ firstName: 'X', email: taken }, A, { 'Idempotency-Key': key })).status).toBe(409);
    expect((await api.create({ firstName: 'X', email: taken }, A, { 'Idempotency-Key': key })).status).toBe(409);
  });

  it('rejects malformed Idempotency-Key', async () => {
    const res = await api.create({ firstName: 'X' }, A, { 'Idempotency-Key': 'has space' });
    expect(res.status).toBe(400);
  });
});

describe('read', () => {
  it('returns a scoped user and hides internal columns', async () => {
    const u = await makeUser();
    const res = await api.get(u.id);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(u.id);
    expect(res.body.data).not.toHaveProperty('deletedAt');
  });

  it('invalid id -> 400, unknown id -> scoped 404', async () => {
    expect((await api.get('abc')).status).toBe(400);
    expect((await api.get('1.5')).status).toBe(400);
    expect((await api.get('0')).status).toBe(400);
    const res = await api.get('999999999999');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('GET /me resolves the actor and is not shadowed by /:id', async () => {
    const me = await makeUser({ firstName: 'Me' });
    const res = await request(app).get('/api/v1/users/me').set(headers({ ...A, actor: me.id }));
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(me.id);
    // actor that does not exist in scope -> 404, never someone else's profile
    const ghost = await request(app).get('/api/v1/users/me').set(headers({ ...A, actor: '777777777' }));
    expect(ghost.status).toBe(404);
  });
});

describe('tenant and organization isolation', () => {
  it('another org / tenant cannot read, update, change status or delete - always the same 404', async () => {
    const u = await makeUser();
    for (const other of [OTHER_ORG, OTHER_TENANT]) {
      const results = [
        await api.get(u.id, other),
        await api.patch(u.id, { designation: 'Hacked' }, other),
        await api.status(u.id, { status: 'suspended' }, other),
        await api.del(u.id, other),
      ];
      for (const r of results) {
        expect(r.status).toBe(404);
        expect(r.body.error.code).toBe('USER_NOT_FOUND');
      }
      const me = await request(app).get('/api/v1/users/me').set(headers({ ...other, actor: u.id }));
      expect(me.status).toBe(404);
    }
    const still = await api.get(u.id);
    expect(still.status).toBe(200);
    expect(still.body.data.designation).toBeNull();
    expect(still.body.data.status).toBe('active');
  });

  it('listing only returns the caller scope', async () => {
    const marker = `Iso${Date.now()}`;
    await makeUser({ firstName: marker });
    await makeUser({ firstName: marker }, OTHER_ORG);
    await makeUser({ firstName: marker }, OTHER_TENANT);
    const res = await api.list(`?search=${marker}`);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data.every((u: any) => u.tenantId === '1001' && u.organizationId === '5001')).toBe(true);
  });
});

describe('BIGINT safety', () => {
  it('round-trips ids above Number.MAX_SAFE_INTEGER exactly as strings', async () => {
    const big: Ctx = { tenant: '9007199254740999', org: '9223372036854775807', actor: '9007199254741001' };
    const u = await makeUser({ roleId: '9007199254740993', departmentId: '9223372036854775806' }, big);
    expect(u.tenantId).toBe('9007199254740999');
    expect(u.organizationId).toBe('9223372036854775807');
    expect(u.createdBy).toBe('9007199254741001');
    expect(u.roleId).toBe('9007199254740993');
    expect(u.departmentId).toBe('9223372036854775806');
    const list = await api.list('?roleId=9007199254740993', big);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].roleId).toBe('9007199254740993');
  });

  it('rejects ids beyond int64', async () => {
    expect((await api.list('', { ...A, tenant: '9223372036854775808' })).status).toBe(400);
    expect((await api.create({ firstName: 'X', roleId: '9223372036854775808' })).status).toBe(400);
  });
});

describe('update', () => {
  it('updates whitelisted fields, sets updated_by/updated_at, leaves the rest alone', async () => {
    const u = await makeUser({ phone: '9876543210', designation: 'Exec' });
    const res = await api.patch(u.id, { phone: '9999999999', designation: 'Senior Exec', roleId: '21' }, { ...A, actor: '501999' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ phone: '9999999999', designation: 'Senior Exec', roleId: '21', updatedBy: '501999', createdBy: '501200', firstName: 'Aman' });
    expect(new Date(res.body.data.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(u.updatedAt).getTime());
  });

  it('null clears optional fields', async () => {
    const u = await makeUser({ designation: 'Exec', roleId: '5' });
    const res = await api.patch(u.id, { designation: null, roleId: null });
    expect(res.body.data).toMatchObject({ designation: null, roleId: null });
  });

  it('rejects empty body, unknown fields, scope fields and status via generic PATCH', async () => {
    const u = await makeUser();
    for (const body of [{}, { foo: 'bar' }, { tenantId: '1' }, { organizationId: '1' }, { createdBy: '1' }, { deletedAt: null }, { id: '1' }, { status: 'suspended' }]) {
      const res = await api.patch(u.id, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('email change conflicting with another active user -> 409', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const res = await api.patch(b.id, { email: a.email });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USER_EMAIL_CONFLICT');
  });

  it('cannot update a soft-deleted user', async () => {
    const u = await makeUser();
    await api.del(u.id);
    expect((await api.patch(u.id, { designation: 'x' })).status).toBe(404);
  });
});

describe('status lifecycle', () => {
  it('accepts the four enum values and records the actor', async () => {
    const u = await makeUser();
    for (const status of ['inactive', 'suspended', 'invited', 'active']) {
      const res = await api.status(u.id, { status }, { ...A, actor: '501777' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(status);
      expect(res.body.data.updatedBy).toBe('501777');
    }
  });

  it('rejects invalid values', async () => {
    const u = await makeUser();
    for (const body of [{ status: 'deleted' }, { status: '' }, {}, { status: 'active', extra: 1 }]) {
      expect((await api.status(u.id, body)).status).toBe(400);
    }
  });

  it('actor cannot deactivate/suspend or delete themselves', async () => {
    const u = await makeUser();
    const self: Ctx = { ...A, actor: u.id };
    expect((await api.status(u.id, { status: 'suspended' }, self)).status).toBe(403);
    expect((await api.del(u.id, self)).status).toBe(403);
    expect((await api.get(u.id)).body.data.status).toBe('active');
  });
});

describe('soft delete', () => {
  it('sets deleted_at, hides the record from GET/list, keeps the row, and second delete is 404', async () => {
    const u = await makeUser({ firstName: `Del${Date.now()}` });
    const del = await api.del(u.id, { ...A, actor: '501888' });
    expect(del.status).toBe(200);
    expect((await api.get(u.id)).status).toBe(404);
    expect((await api.list(`?search=${u.firstName}`)).body.meta.total).toBe(0);
    const { rows } = await pool.query('SELECT deleted_at, updated_by::TEXT AS ub FROM users WHERE id = $1::BIGINT', [u.id]);
    expect(rows[0].deleted_at).not.toBeNull();
    expect(rows[0].ub).toBe('501888');
    expect((await api.del(u.id)).status).toBe(404);
  });
});

describe('list, search, filter, pagination, sorting', () => {
  const marker = `Lst${Date.now()}`;
  const LIST_ORG: Ctx = { tenant: '3003', org: '6006', actor: '1' };

  beforeAll(async () => {
    for (let i = 0; i < 7; i++) {
      await makeUser(
        {
          firstName: `${marker}${String.fromCharCode(65 + i)}`,
          lastName: i % 2 ? 'Odd' : 'Even',
          roleId: i < 3 ? '20' : '21',
          departmentId: '10',
          phone: `98765432${i}0`,
        },
        LIST_ORG,
      );
    }
    const inactive = (await api.list(`?search=${marker}G`, LIST_ORG)).body.data[0];
    await api.status(inactive.id, { status: 'inactive' }, LIST_ORG);
  });

  it('paginates with correct meta and caps limit at MAX_PAGE_SIZE', async () => {
    const p1 = await api.list('?page=1&limit=3&sort=firstName:asc', LIST_ORG);
    expect(p1.body.meta).toEqual({ page: 1, limit: 3, total: 7, totalPages: 3 });
    expect(p1.body.data.map((u: any) => u.firstName)).toEqual([`${marker}A`, `${marker}B`, `${marker}C`]);
    const p3 = await api.list('?page=3&limit=3&sort=firstName:asc', LIST_ORG);
    expect(p3.body.data).toHaveLength(1);
    const beyond = await api.list('?page=9&limit=3', LIST_ORG);
    expect(beyond.body.data).toHaveLength(0);
    const capped = await api.list('?limit=100000', LIST_ORG);
    expect(capped.body.meta.limit).toBe(50);
  });

  it('filters by status, roleId, departmentId and combinations', async () => {
    expect((await api.list('?status=inactive', LIST_ORG)).body.meta.total).toBe(1);
    expect((await api.list('?status=active', LIST_ORG)).body.meta.total).toBe(6);
    expect((await api.list('?roleId=20', LIST_ORG)).body.meta.total).toBe(3);
    expect((await api.list('?roleId=21&status=active', LIST_ORG)).body.meta.total).toBe(3);
    expect((await api.list('?departmentId=10', LIST_ORG)).body.meta.total).toBe(7);
    expect((await api.list('?departmentId=11', LIST_ORG)).body.meta.total).toBe(0);
  });

  it('searches name, full name, email, phone case-insensitively; treats % and _ literally', async () => {
    expect((await api.list(`?search=${marker.toLowerCase()}a`, LIST_ORG)).body.meta.total).toBe(1);
    expect((await api.list(`?search=${marker}A Even`, LIST_ORG)).body.meta.total).toBe(1);
    expect((await api.list('?search=odd', LIST_ORG)).body.meta.total).toBe(3);
    expect((await api.list('?search=9876543210', LIST_ORG)).body.meta.total).toBe(1);
    expect((await api.list('?search=@company.com', LIST_ORG)).body.meta.total).toBe(7);
    expect((await api.list('?search=%25', LIST_ORG)).body.meta.total).toBe(0);
    expect((await api.list('?search=_', LIST_ORG)).body.meta.total).toBe(0);
  });

  it('sorts by whitelisted fields and rejects anything else', async () => {
    const desc = await api.list('?sort=firstName:desc&limit=2', LIST_ORG);
    expect(desc.body.data[0].firstName).toBe(`${marker}G`);
    expect((await api.list('?sort=password:asc', LIST_ORG)).status).toBe(400);
    expect((await api.list('?sort=createdAt;DROP TABLE users', LIST_ORG)).status).toBe(400);
  });

  it('SQL-injection style input is inert', async () => {
    const res = await api.list(`?search=${encodeURIComponent("'; DROP TABLE users; --")}`, LIST_ORG);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(0);
    expect((await api.list('', LIST_ORG)).body.meta.total).toBe(7);
  });

  it('validates page/limit/filters', async () => {
    for (const qs of ['?page=0', '?limit=0', '?page=abc', '?status=gone', '?roleId=abc', '?bogus=1', '?page=1&page=2']) {
      expect((await api.list(qs, LIST_ORG)).status).toBe(400);
    }
  });
});

describe('error envelope', () => {
  it('never leaks internals and always carries requestId', async () => {
    const res = await api.get('999999999999');
    expect(res.body).toMatchObject({ success: false, error: { code: 'USER_NOT_FOUND', details: [] } });
    expect(res.body.requestId).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/SELECT|stack|postgres/i);
  });
});
