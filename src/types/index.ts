/** All identifiers are decimal strings end-to-end (Report section 8). Never convert to Number. */
export type BigIntId = string;

export const USER_STATUSES = ['active', 'inactive', 'invited', 'suspended'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Trusted request context derived from authenticated headers (Report section 6/7). */
export interface SecurityContext {
  tenantId: BigIntId;
  organizationId: BigIntId;
  softwareId: BigIntId;
  /** The user performing the operation - never conflated with the target user. */
  actorUserId: BigIntId;
  /** Role names granted to the actor (JWT `roles` claim, or ['service'] for the static token). */
  roles: string[];
  requestId: string;
}

export interface Scope {
  tenantId: BigIntId;
  organizationId: BigIntId;
}

export interface UserDto {
  id: BigIntId;
  tenantId: BigIntId;
  organizationId: BigIntId;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  roleId: BigIntId | null;
  departmentId: BigIntId | null;
  designation: string | null;
  profileImageUrl: string | null;
  status: UserStatus;
  createdBy: BigIntId | null;
  updatedBy: BigIntId | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  roleId?: BigIntId | null;
  departmentId?: BigIntId | null;
  designation?: string | null;
  profileImageUrl?: string | null;
  status?: 'active' | 'invited';
}

export type UpdateUserInput = Partial<Omit<CreateUserInput, 'status'>>;

export const SORT_FIELDS = ['createdAt', 'updatedAt', 'firstName', 'lastName', 'email', 'status'] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export interface ListUsersQuery {
  page: number;
  limit: number;
  status?: UserStatus;
  roleId?: BigIntId;
  departmentId?: BigIntId;
  search?: string;
  sortField: SortField;
  sortDir: 'asc' | 'desc';
}
