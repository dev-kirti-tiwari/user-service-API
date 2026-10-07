import { createHash } from 'crypto';
import { authorizeUpdate, requirePermission } from '../authz/permissions';
import { pool, withTransaction } from '../config/database';
import { env } from '../config/env';
import { idempotencyRepository } from '../repositories/idempotency.repository';
import { userRepository } from '../repositories/user.repository';
import {
  CreateUserInput,
  ListUsersQuery,
  Scope,
  SecurityContext,
  UpdateUserInput,
  UserDto,
  UserStatus,
} from '../types';
import { emitAudit } from '../utils/audit';
import { AppError } from '../utils/errors';

const scopeOf = (ctx: SecurityContext): Scope => ({ tenantId: ctx.tenantId, organizationId: ctx.organizationId });

function isEmailConflict(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && e.constraint === 'uq_users_scope_email';
}

function emailConflict(): AppError {
  return new AppError(409, 'USER_EMAIL_CONFLICT', 'An active user with this email already exists in this organization');
}

/** Canonical JSON (sorted keys) so equivalent payloads hash identically regardless of key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export const hashPayload = (input: unknown) => createHash('sha256').update(canonical(input)).digest('hex');

export interface CreateResult {
  user: UserDto;
  replayed: boolean;
}

export const userService = {
  async create(ctx: SecurityContext, input: CreateUserInput, idempotencyKey?: string): Promise<CreateResult> {
    requirePermission(ctx, 'user:create');
    const scope = scopeOf(ctx);

    if (!idempotencyKey) {
      try {
        const user = await userRepository.insert(pool, scope, ctx.actorUserId, input);
        this.auditCreated(ctx, user);
        return { user, replayed: false };
      } catch (err) {
        throw isEmailConflict(err) ? emailConflict() : err;
      }
    }

    const hash = hashPayload(input);
    try {
      const result = await withTransaction(async (client): Promise<CreateResult> => {
        const claimed = await idempotencyRepository.claim(client, scope, idempotencyKey, hash, env.IDEMPOTENCY_TTL_HOURS);
        if (!claimed) {
          const existing = await idempotencyRepository.find(client, scope, idempotencyKey);
          if (!existing || existing.requestHash !== hash) {
            throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used with a different request payload');
          }
          if (!existing.response) {
            throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'A request with this Idempotency-Key is still being processed');
          }
          return { user: existing.response, replayed: true };
        }
        const user = await userRepository.insert(client, scope, ctx.actorUserId, input);
        await idempotencyRepository.complete(client, scope, idempotencyKey, user);
        return { user, replayed: false };
      });
      if (!result.replayed) this.auditCreated(ctx, result.user);
      return result;
    } catch (err) {
      throw isEmailConflict(err) ? emailConflict() : err;
    }
  },

  auditCreated(ctx: SecurityContext, user: UserDto): void {
    emitAudit({
      event: 'user.created',
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      actorUserId: ctx.actorUserId,
      targetUserId: user.id,
      requestId: ctx.requestId,
      changedFields: [],
      result: 'success',
    });
  },

  async list(ctx: SecurityContext, query: ListUsersQuery) {
    requirePermission(ctx, 'user:read');
    const { rows, total } = await userRepository.list(pool, scopeOf(ctx), query);
    return {
      users: rows,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  },

  async getById(ctx: SecurityContext, id: string): Promise<UserDto> {
    requirePermission(ctx, 'user:read');
    // Cross-tenant / cross-org / missing / soft-deleted all produce the same scoped 404 (no existence leak).
    const user = await userRepository.findById(pool, scopeOf(ctx), id);
    if (!user) throw AppError.userNotFound();
    return user;
  },

  /** Actor resolved from trusted context - the caller cannot name a target. */
  async getMe(ctx: SecurityContext): Promise<UserDto> {
    // Any authenticated actor may read their own profile (no user:read needed).
    const user = await userRepository.findById(pool, scopeOf(ctx), ctx.actorUserId);
    if (!user) throw AppError.userNotFound();
    return user;
  },

  async update(ctx: SecurityContext, id: string, patch: UpdateUserInput): Promise<UserDto> {
    authorizeUpdate(ctx, id, Object.keys(patch));
    let user: UserDto | null;
    try {
      user = await userRepository.update(pool, scopeOf(ctx), id, ctx.actorUserId, patch);
    } catch (err) {
      throw isEmailConflict(err) ? emailConflict() : err;
    }
    if (!user) throw AppError.userNotFound();
    emitAudit({
      event: 'user.updated',
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      actorUserId: ctx.actorUserId,
      targetUserId: id,
      requestId: ctx.requestId,
      changedFields: Object.keys(patch),
      result: 'success',
    });
    return user;
  },

  async changeStatus(ctx: SecurityContext, id: string, status: UserStatus): Promise<UserDto> {
    requirePermission(ctx, 'user:change_status');
    // Guard against an actor locking themselves out through the status endpoint.
    if (id === ctx.actorUserId && status !== 'active') {
      throw AppError.forbidden('Actors cannot deactivate or suspend their own account');
    }
    const user = await userRepository.updateStatus(pool, scopeOf(ctx), id, ctx.actorUserId, status);
    if (!user) throw AppError.userNotFound();
    emitAudit({
      event: 'user.status_changed',
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      actorUserId: ctx.actorUserId,
      targetUserId: id,
      requestId: ctx.requestId,
      changedFields: ['status'],
      result: 'success',
    });
    return user;
  },

  async remove(ctx: SecurityContext, id: string): Promise<void> {
    requirePermission(ctx, 'user:delete');
    if (id === ctx.actorUserId) {
      throw AppError.forbidden('Actors cannot delete their own account');
    }
    const deleted = await userRepository.softDelete(pool, scopeOf(ctx), id, ctx.actorUserId);
    if (!deleted) throw AppError.userNotFound();
    emitAudit({
      event: 'user.deleted',
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      actorUserId: ctx.actorUserId,
      targetUserId: id,
      requestId: ctx.requestId,
      changedFields: ['deletedAt'],
      result: 'success',
    });
  },
};
