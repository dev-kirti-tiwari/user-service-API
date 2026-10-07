import { SecurityContext } from '../types';
import { AppError } from '../utils/errors';

/**
 * Permission model (Report 15.2). Roles come from the verified JWT `roles` claim; the User Service only
 * maps role names to permissions. Fine-grained policy can later move to a central Role/Permission Service
 * by replacing ROLE_PERMISSIONS with a lookup - nothing else needs to change.
 */
export type Permission =
  | 'user:create'
  | 'user:read'
  | 'user:update'
  | 'user:assign_role'
  | 'user:change_status'
  | 'user:delete';

export const ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  admin: ['user:create', 'user:read', 'user:update', 'user:assign_role', 'user:change_status', 'user:delete'],
  manager: ['user:create', 'user:read', 'user:update'],
  member: ['user:read'],
  // Trusted internal caller authenticated with the static token (service-to-service).
  service: ['user:create', 'user:read', 'user:update', 'user:assign_role', 'user:change_status', 'user:delete'],
};

/** Fields an ordinary user may change on their OWN profile ("restricted self-service fields only"). */
export const SELF_SERVICE_FIELDS = ['firstName', 'lastName', 'phone', 'designation', 'profileImageUrl'] as const;

/** Fields that change a user's authorization footprint - privileged roles only (Report 15.2: "Change role/status"). */
const PRIVILEGED_FIELDS = ['roleId'] as const;

export function hasPermission(ctx: SecurityContext, permission: Permission): boolean {
  return ctx.roles.some((r) => ROLE_PERMISSIONS[r]?.includes(permission));
}

export function requirePermission(ctx: SecurityContext, permission: Permission): void {
  if (!hasPermission(ctx, permission)) {
    throw AppError.forbidden(`Missing permission: ${permission}`);
  }
}

/** Authorizes a PATCH given the actor, the target and the fields being changed. */
export function authorizeUpdate(ctx: SecurityContext, targetUserId: string, fields: string[]): void {
  if (fields.some((f) => (PRIVILEGED_FIELDS as readonly string[]).includes(f))) {
    requirePermission(ctx, 'user:assign_role');
  }
  if (hasPermission(ctx, 'user:update')) return;

  // Without user:update, only the actor's own record and only self-service fields are allowed.
  const isSelf = targetUserId === ctx.actorUserId;
  const onlySelfFields = fields.every((f) => (SELF_SERVICE_FIELDS as readonly string[]).includes(f));
  if (!(isSelf && onlySelfFields)) {
    throw AppError.forbidden('Not permitted to update this user or these fields');
  }
}
