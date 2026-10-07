# Triostack User Service

A reusable, **multi-tenant User API microservice** built with **TypeScript, Express and PostgreSQL**.
It is the single source of truth for *who a user is* across the Triostack product suite (CRM, HRMS, Helpdesk,
Projects, WABiz, Notifications and others).

---

## Table of contents

1. [Why this service exists](#1-why-this-service-exists)
2. [What it does (and does not do)](#2-what-it-does-and-does-not-do)
3. [Tech stack](#3-tech-stack)
4. [How it works](#4-how-it-works)
5. [Project structure](#5-project-structure)
6. [Getting started](#6-getting-started)
7. [Configuration](#7-configuration)
8. [Authentication and permissions](#8-authentication-and-permissions)
9. [API reference](#9-api-reference)
10. [Data model](#10-data-model)
11. [Security design](#11-security-design)
12. [Testing](#12-testing)
13. [Troubleshooting](#13-troubleshooting)
14. [Limitations and roadmap](#14-limitations-and-roadmap)

---

## 1. Why this service exists

When every product keeps its own user table, the same person ends up stored several times:

- a name changed in HRMS stays stale in CRM,
- a suspended account still shows up as assignable in Helpdesk,
- every module re-implements its own tenant/organization checks, so isolation bugs creep in,
- hard-deleting a user breaks old leads, tickets and audit records that point at them.

This service replaces those copies with **one API** that owns the user record, its lifecycle status, and the
tenant and organization boundaries, so every module asks the same place.

## 2. What it does (and does not do)

**It does**

- Create, read, update, and soft-delete users inside a tenant and organization.
- Manage lifecycle status: `active`, `inactive`, `invited`, `suspended`.
- Return the current actor's profile (`/me`).
- Search, filter, sort and paginate the user directory.
- Keep `created_by` / `updated_by` and emit audit events (actor vs. target are always separate).
- Make `POST /users` safe to retry using an `Idempotency-Key`.

**It does not** (these belong to other services)

| Concern | Owner |
|---|---|
| Passwords, OTP, MFA, sessions, refresh tokens | Auth Service |
| Fine-grained permission evaluation | Role/Permission Service |
| Lead assignment / round-robin | CRM |
| Sending notifications, WhatsApp messages | Notification / WABiz |

## 3. Tech stack

| Layer | Choice |
|---|---|
| Runtime / language | Node.js 20+, TypeScript |
| HTTP | Express 4 |
| Database | PostgreSQL (`pg`, parameterized SQL only) |
| Validation | Zod |
| Auth | Static bearer token (dev) or signed JWT (`jsonwebtoken`) |
| Hardening | Helmet, express-rate-limit |
| Tests | Vitest + Supertest, real PostgreSQL (embedded) |
| Packaging | Docker, Docker Compose |

## 4. How it works

```
Client / CRM / HRMS / ...
        |
        v
  Route -> Middleware -> Controller -> Service -> Repository -> PostgreSQL
```

For every protected request:

1. A **request ID** is accepted from `X-Request-Id` or generated, and returned in every response.
2. The **bearer token** is verified.
3. The **security context** is built: tenant, organization, software and actor. These come from the verified
   token (or trusted gateway headers in dev mode), **never from the request body**.
4. The **service layer** checks the actor's permissions.
5. The **validator** checks and normalizes path, query and body data.
6. The **repository** runs parameterized SQL that **always** includes `tenant_id` and `organization_id`
   (plus `deleted_at IS NULL`).
7. A standard JSON envelope is returned.

Key design decisions:

- **IDs are strings.** PostgreSQL `BIGINT` can exceed JavaScript's safe integer range, so IDs travel as decimal
  strings from the HTTP request to SQL to JSON (`"id": "501233"`), and are validated as positive 64-bit values.
- **Soft delete.** `DELETE` sets `deleted_at`; old references in other systems stay valid.
- **No existence leaks.** A user in another tenant or organization, a deleted user and a missing user all return
  the identical `404 USER_NOT_FOUND`.

## 5. Project structure

```
src/
  config/        env.ts (validated settings), database.ts (pool, TLS, transactions)
  authz/         permissions.ts (roles -> permissions)
  middleware/    auth, security-context, request-id, request-logger, rate-limit, error
  validators/    user.validator.ts (Zod schemas, normalization)
  controllers/   HTTP <-> service translation
  services/      business rules, permission checks, idempotency, audit
  repositories/  all SQL (user + idempotency)
  routes/        user routes, health/ready
  utils/         response envelope, errors, bigint, logger, audit
migrations/      001_create_users.sql, 002_create_idempotency_keys.sql
scripts/         migrate.ts, mint-token.ts (dev JWTs)
tests/           unit, API integration, JWT/permission tests
postman/         ready-to-import collection
server.ts        entry point (graceful shutdown, housekeeping)
```

## 6. Getting started

### Prerequisites

- Node.js 20 or newer
- PostgreSQL 14+ **or** Docker Desktop

### Option A: Docker (easiest, includes PostgreSQL)

```bash
# 1. create a .env with a strong token
echo "BRR_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" > .env

# 2. start database + migrations + API
docker compose up --build -d

# 3. check it
curl http://localhost:4020/ready
```

If port 4020 is busy, add `API_PORT=4021` to `.env`. Stop with `docker compose down` (keeps data) or
`docker compose down -v` (deletes data).

### Option B: Run locally

```bash
git clone https://github.com/dev-kirti-tiwari/user-service-API.git
cd user-service-API
npm install
cp .env.example .env        # then edit DATABASE_URL and BRR_TOKEN
npm run migrate             # create tables
npm run dev                 # http://localhost:4020
```

### Useful scripts

| Command | Purpose |
|---|---|
| `npm run dev` | start with auto-reload |
| `npm run build` / `npm start` | compile and run the production build |
| `npm run migrate` | apply SQL migrations |
| `npm test` | run all tests |
| `npm run typecheck` | TypeScript check |
| `npm run token -- --tenant 1001 --org 5001 --user 501200 --roles admin` | mint a dev JWT |

### Try it

```bash
curl -X POST http://localhost:4020/api/v1/users \
  -H "Authorization: Bearer $BRR_TOKEN" \
  -H "X-Tenant-Id: 1001" -H "X-Organization-Id: 5001" \
  -H "X-Software-Id: 10" -H "X-User-Id: 501200" \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Aman","lastName":"Sharma","email":"aman@company.com"}'
```

## 7. Configuration

All settings are environment variables (see `.env.example`). Real secrets live in `.env`, which is git-ignored.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4020` | HTTP port |
| `DATABASE_URL` | required | PostgreSQL connection string |
| `DATABASE_SSL` | `false` | Use TLS to PostgreSQL (certificates verified) |
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `AUTH_MODE` | `static` (dev) / `jwt` (production) | see section 8 |
| `BRR_TOKEN` | required in static mode | Shared bearer token, min 16 chars |
| `JWT_SECRET` / `JWT_PUBLIC_KEY` | | HS256 secret (min 32 chars) or RS256/ES256 public key |
| `JWT_ISSUER`, `JWT_AUDIENCE` | required in jwt mode | Expected token issuer / audience |
| `MAX_PAGE_SIZE` | `100` | Upper bound for `limit` |
| `DB_POOL_MAX` | `20` | Connection pool size |
| `REQUEST_TIMEOUT_MS` | `10000` | Request and DB statement timeout |
| `IDEMPOTENCY_TTL_HOURS` | `24` | How long idempotency keys are remembered |
| `RATE_LIMIT_PER_MINUTE` | `120` | Create/status/delete limit per actor |
| `GLOBAL_RATE_LIMIT_PER_MINUTE` | `600` | Per-IP limit for all API calls |
| `TRUST_PROXY` | `0` | Reverse-proxy hops in front of the service |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |

The service validates settings at startup and exits with a clear message (never printing secret values) if
something is missing or invalid.

## 8. Authentication and permissions

### Modes

| Mode | Use for | How identity is determined |
|---|---|---|
| `static` | local development | Shared `BRR_TOKEN` plus `X-Tenant-Id`, `X-Organization-Id`, `X-Software-Id`, `X-User-Id` headers. Acts as a trusted internal caller with full access. |
| `jwt` | production | A signed JWT. Tenant, organization, software, actor and roles come **only** from its verified claims; identity headers are ignored. |

With `NODE_ENV=production` the service **refuses to start in static mode**.

JWT requirements: algorithm pinned (HS256, or RS256/ES256 with a public key), `exp` required, issuer and audience
checked. Claims: `sub` (actor id), `tenant_id`, `organization_id`, `software_id`, `roles` (array).

### Roles (JWT mode)

| Action | admin | manager | member |
|---|:-:|:-:|:-:|
| Read own profile (`/me`) | yes | yes | yes |
| List / read users | yes | yes | yes |
| Create user | yes | yes | no |
| Update another user's profile | yes | yes | no |
| Update own profile (name, phone, designation, image) | yes | yes | yes |
| Change `roleId` | yes | no | no |
| Change status, delete | yes | no | no |

An actor can never suspend, deactivate or delete their own account. The role-to-permission map is in
`src/authz/permissions.ts`.

## 9. API reference

Base path: `/api/v1`. Every protected request needs `Authorization: Bearer <token>`; in static mode also the four
`X-*` identity headers. Optional: `X-Request-Id`, and `Idempotency-Key` on `POST /users`.

| Method | Path | Description | Success |
|---|---|---|---|
| POST | `/users` | Create a user | 201 |
| GET | `/users` | List, search, filter, paginate | 200 |
| GET | `/users/me` | Current actor's profile | 200 |
| GET | `/users/:id` | One user in scope | 200 |
| PATCH | `/users/:id` | Update profile fields | 200 |
| PATCH | `/users/:id/status` | Change lifecycle status | 200 |
| DELETE | `/users/:id` | Soft delete | 200 |
| GET | `/health` | Liveness (public) | 200 |
| GET | `/ready` | Readiness: config, database, migrations | 200 / 503 |

### Create user

`POST /api/v1/users`

```json
{
  "firstName": "Aman",
  "lastName": "Sharma",
  "email": "aman@company.com",
  "phone": "9876543210",
  "roleId": "20",
  "departmentId": "10",
  "designation": "Sales Executive"
}
```

Only `firstName` is required. Email is lower-cased and must be unique among active users in the same tenant and
organization. Sending `tenantId`, `organizationId`, `createdBy` or any unknown field returns `400`.

Response `201`:

```json
{
  "success": true,
  "message": "User created successfully",
  "data": {
    "id": "501233", "tenantId": "1001", "organizationId": "5001",
    "firstName": "Aman", "lastName": "Sharma", "email": "aman@company.com",
    "phone": "9876543210", "roleId": "20", "departmentId": "10",
    "designation": "Sales Executive", "profileImageUrl": null, "status": "active",
    "createdBy": "501200", "updatedBy": "501200",
    "createdAt": "2026-10-07T14:06:49.277Z", "updatedAt": "2026-10-07T14:06:49.277Z"
  },
  "requestId": "req_..."
}
```

**Idempotency:** send the same `Idempotency-Key` with the same payload and the original result is returned again
(header `Idempotent-Replayed: true`) with no second user created. The same key with a different payload returns `409`.

### List users

`GET /api/v1/users?status=active&roleId=20&search=aman&page=1&limit=20&sort=createdAt:desc`

| Parameter | Notes |
|---|---|
| `page` | integer >= 1 (default 1) |
| `limit` | integer >= 1, capped at `MAX_PAGE_SIZE` (default 20) |
| `status` | `active`, `inactive`, `invited`, `suspended` |
| `roleId`, `departmentId` | positive BIGINT string |
| `search` | case-insensitive match on name, email, phone |
| `sort` | `field:asc|desc`; fields: `createdAt`, `updatedAt`, `firstName`, `lastName`, `email`, `status` |

Response includes `meta`: `{ "page": 1, "limit": 20, "total": 73, "totalPages": 4 }`.

### Update and status

- `PATCH /users/:id` accepts at least one of `firstName`, `lastName`, `email`, `phone`, `roleId`, `departmentId`,
  `designation`, `profileImageUrl` (`null` clears optional fields). `status`, scope and audit fields are rejected.
- `PATCH /users/:id/status` accepts `{ "status": "inactive" }`.

### Response envelopes

Success: `{ "success": true, "message": "...", "data": ..., "meta": ..., "requestId": "..." }`

Error:

```json
{
  "success": false,
  "error": { "code": "USER_NOT_FOUND", "message": "User not found within current security scope", "details": [] },
  "requestId": "req_..."
}
```

### Error codes

| HTTP | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | bad body, query, path or identity headers |
| 401 | `AUTHORIZATION_REQUIRED` | no `Authorization` header |
| 401 | `INVALID_BEARER_TOKEN` | invalid, expired or malformed token |
| 403 | `FORBIDDEN` | actor lacks permission |
| 404 | `USER_NOT_FOUND` | not found in scope (also cross-tenant / deleted) |
| 404 | `ROUTE_NOT_FOUND` | unknown path |
| 409 | `USER_EMAIL_CONFLICT` | active email already exists in scope |
| 409 | `IDEMPOTENCY_CONFLICT` | key reused with a different payload |
| 429 | `RATE_LIMITED` | too many requests |
| 500 | `INTERNAL_ERROR` | unexpected failure (details only in logs) |
| 503 | `SERVICE_NOT_READY` | database or dependency unavailable |

## 10. Data model

Table `users` (see `migrations/001_create_users.sql`): `id` (BIGSERIAL), `tenant_id`, `organization_id`,
`first_name`, `last_name`, `email`, `phone`, `role_id`, `department_id`, `designation`, `profile_image_url`,
`status` (CHECK constraint), `created_by`, `updated_by`, `created_at`, `updated_at`, `deleted_at`.

Indexes cover tenant+organization scope with status, role and department, and a **partial unique index** on
`(tenant_id, organization_id, LOWER(email))` for non-deleted users, so an email can be reused after its owner is
soft-deleted. Table `idempotency_keys` (migration 002) backs safe retries.

## 11. Security design

- Tenant and organization are in the `WHERE` clause of every query; the body is never trusted for scope or actor.
- Parameterized SQL only; sort fields and updatable columns are whitelists.
- Constant-time token comparison; pinned JWT algorithms; secrets never logged and never echoed in errors.
- Helmet security headers, per-IP and per-actor rate limits, 100 KB body limit, request and statement timeouts.
- Errors never leak SQL, hostnames or stack traces.
- Structured JSON logs with request ID, latency and error code; audit events
  (`user.created`, `user.updated`, `user.status_changed`, `user.deleted`) include actor, target and changed fields.

## 12. Testing

```bash
npm test
```

79 tests cover authentication, header validation, CRUD, tenant and organization isolation, 64-bit ID round-trips,
idempotency (including concurrent requests), search/filter/pagination/sorting, injection attempts, JWT and role
permissions, and startup safety checks. They run against a real PostgreSQL: an embedded instance starts
automatically, or set `TEST_DATABASE_URL` to use your own.

A Postman collection is in `postman/user-service.postman_collection.json`. Import it, create an environment with
`base_url`, `brr_token`, `tenant_id`, `organization_id`, `software_id` and `actor_user_id`, select that
environment, then run **Create user** first.

## 13. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `401 AUTHORIZATION_REQUIRED` | No token was sent. In Postman make sure an environment containing `brr_token` is **selected**. |
| `401 INVALID_BEARER_TOKEN` | Token does not match `BRR_TOKEN` in `.env` (extra spaces or quotes?), or the JWT is expired. |
| `400` about `X-Tenant-Id` etc. | Static mode needs all four identity headers, each a positive integer. |
| `404 ROUTE_NOT_FOUND` on create | Wrong URL or wrong port; it must be `POST /api/v1/users`. |
| `503` on `/ready` | PostgreSQL unreachable or migrations not applied: run `npm run migrate`. |
| Port already in use | Change `PORT` (or `API_PORT` with Docker). |
| Service exits at startup | Read the message: it lists which environment variables are missing or invalid. |

## 14. Limitations and roadmap

- Static mode trusts identity headers: use it only for local development or behind a trusted gateway.
- Roles come from the token, so role changes apply once a new token is issued; keep token lifetimes short.
- Audit events are written to the log stream; a durable outbox / Audit Service is a planned improvement.
- One user belongs to one organization in V1. Multi-organization membership, a per-software access table,
  Redis caching, an OpenAPI specification and SCIM provisioning are future work.
- Email uniqueness is per tenant and organization among active users; confirm this rule with product policy.
