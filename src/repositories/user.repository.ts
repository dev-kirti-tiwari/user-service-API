import { Pool, PoolClient } from 'pg';
import { pool } from '../config/database';
import { CreateUserInput, ListUsersQuery, Scope, SortField, UpdateUserInput, UserDto, UserStatus } from '../types';

export type Db = Pool | PoolClient;

/**
 * Every query below carries tenant_id AND organization_id (Report "Critical query rule") and,
 * for ordinary reads/writes, `deleted_at IS NULL`. All values are bound parameters; the only
 * interpolated SQL fragments come from fixed whitelists in this file.
 */
const COLUMNS = `
  id::TEXT AS id,
  tenant_id::TEXT AS "tenantId",
  organization_id::TEXT AS "organizationId",
  first_name AS "firstName",
  last_name AS "lastName",
  email,
  phone,
  role_id::TEXT AS "roleId",
  department_id::TEXT AS "departmentId",
  designation,
  profile_image_url AS "profileImageUrl",
  status,
  created_by::TEXT AS "createdBy",
  updated_by::TEXT AS "updatedBy",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

const SORT_COLUMNS: Record<SortField, { sql: string; nullable: boolean }> = {
  createdAt: { sql: 'created_at', nullable: false },
  updatedAt: { sql: 'updated_at', nullable: false },
  firstName: { sql: 'LOWER(first_name)', nullable: false },
  lastName: { sql: 'LOWER(last_name)', nullable: true },
  email: { sql: 'LOWER(email)', nullable: true },
  status: { sql: 'status', nullable: false },
};

/** Maps API field names to columns for PATCH. Only these fields can ever be updated generically. */
const UPDATE_COLUMNS: Record<keyof UpdateUserInput, { column: string; cast?: string }> = {
  firstName: { column: 'first_name' },
  lastName: { column: 'last_name' },
  email: { column: 'email' },
  phone: { column: 'phone' },
  roleId: { column: 'role_id', cast: '::BIGINT' },
  departmentId: { column: 'department_id', cast: '::BIGINT' },
  designation: { column: 'designation' },
  profileImageUrl: { column: 'profile_image_url' },
};

function toIso<T extends { createdAt: unknown; updatedAt: unknown }>(row: T): T {
  return {
    ...row,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const userRepository = {
  async insert(db: Db, scope: Scope, actorUserId: string, input: CreateUserInput): Promise<UserDto> {
    const { rows } = await db.query(
      `INSERT INTO users (
         tenant_id, organization_id, first_name, last_name, email, phone,
         role_id, department_id, designation, profile_image_url, status, created_by, updated_by
       ) VALUES (
         $1::BIGINT, $2::BIGINT, $3, $4, $5, $6,
         $7::BIGINT, $8::BIGINT, $9, $10, $11, $12::BIGINT, $12::BIGINT
       )
       RETURNING ${COLUMNS}`,
      [
        scope.tenantId,
        scope.organizationId,
        input.firstName,
        input.lastName ?? null,
        input.email ?? null,
        input.phone ?? null,
        input.roleId ?? null,
        input.departmentId ?? null,
        input.designation ?? null,
        input.profileImageUrl ?? null,
        input.status ?? 'active',
        actorUserId,
      ],
    );
    return toIso(rows[0]);
  },

  async findById(db: Db, scope: Scope, id: string): Promise<UserDto | null> {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM users
        WHERE id = $1::BIGINT
          AND tenant_id = $2::BIGINT
          AND organization_id = $3::BIGINT
          AND deleted_at IS NULL`,
      [id, scope.tenantId, scope.organizationId],
    );
    return rows[0] ? toIso(rows[0]) : null;
  },

  async list(db: Db, scope: Scope, q: ListUsersQuery): Promise<{ rows: UserDto[]; total: number }> {
    const params: unknown[] = [scope.tenantId, scope.organizationId];
    const where: string[] = ['tenant_id = $1::BIGINT', 'organization_id = $2::BIGINT', 'deleted_at IS NULL'];

    if (q.status) {
      params.push(q.status);
      where.push(`status = $${params.length}`);
    }
    if (q.roleId) {
      params.push(q.roleId);
      where.push(`role_id = $${params.length}::BIGINT`);
    }
    if (q.departmentId) {
      params.push(q.departmentId);
      where.push(`department_id = $${params.length}::BIGINT`);
    }
    if (q.search) {
      params.push(`%${escapeLike(q.search)}%`);
      const p = `$${params.length}`;
      where.push(
        `(first_name ILIKE ${p} ESCAPE '\\'
          OR last_name ILIKE ${p} ESCAPE '\\'
          OR (first_name || ' ' || COALESCE(last_name, '')) ILIKE ${p} ESCAPE '\\'
          OR email ILIKE ${p} ESCAPE '\\'
          OR phone ILIKE ${p} ESCAPE '\\')`,
      );
    }

    const whereSql = where.join(' AND ');
    const sort = SORT_COLUMNS[q.sortField];
    const dir = q.sortDir === 'asc' ? 'ASC' : 'DESC';
    const nulls = sort.nullable ? ' NULLS LAST' : '';
    const offset = (q.page - 1) * q.limit;

    const [countRes, dataRes] = await Promise.all([
      db.query(`SELECT COUNT(*)::TEXT AS total FROM users WHERE ${whereSql}`, params),
      db.query(
        `SELECT ${COLUMNS} FROM users
          WHERE ${whereSql}
          ORDER BY ${sort.sql} ${dir}${nulls}, id ${dir}
          LIMIT $${params.length + 1}::INT OFFSET $${params.length + 2}::INT`,
        [...params, q.limit, offset],
      ),
    ]);

    return { rows: dataRes.rows.map(toIso), total: Number(countRes.rows[0].total) };
  },

  async update(db: Db, scope: Scope, id: string, actorUserId: string, patch: UpdateUserInput): Promise<UserDto | null> {
    const params: unknown[] = [id, scope.tenantId, scope.organizationId, actorUserId];
    const sets: string[] = ['updated_at = NOW()', 'updated_by = $4::BIGINT'];

    for (const key of Object.keys(patch) as (keyof UpdateUserInput)[]) {
      const mapping = UPDATE_COLUMNS[key];
      if (!mapping) continue; // unreachable after validation; defence in depth against over-posting
      params.push(patch[key] ?? null);
      sets.push(`${mapping.column} = $${params.length}${mapping.cast ?? ''}`);
    }

    const { rows } = await db.query(
      `UPDATE users SET ${sets.join(', ')}
        WHERE id = $1::BIGINT
          AND tenant_id = $2::BIGINT
          AND organization_id = $3::BIGINT
          AND deleted_at IS NULL
        RETURNING ${COLUMNS}`,
      params,
    );
    return rows[0] ? toIso(rows[0]) : null;
  },

  async updateStatus(db: Db, scope: Scope, id: string, actorUserId: string, status: UserStatus): Promise<UserDto | null> {
    const { rows } = await db.query(
      `UPDATE users
          SET status = $5, updated_at = NOW(), updated_by = $4::BIGINT
        WHERE id = $1::BIGINT
          AND tenant_id = $2::BIGINT
          AND organization_id = $3::BIGINT
          AND deleted_at IS NULL
        RETURNING ${COLUMNS}`,
      [id, scope.tenantId, scope.organizationId, actorUserId, status],
    );
    return rows[0] ? toIso(rows[0]) : null;
  },

  async softDelete(db: Db, scope: Scope, id: string, actorUserId: string): Promise<boolean> {
    const { rows } = await db.query(
      `UPDATE users
          SET deleted_at = NOW(), updated_at = NOW(), updated_by = $4::BIGINT
        WHERE id = $1::BIGINT
          AND tenant_id = $2::BIGINT
          AND organization_id = $3::BIGINT
          AND deleted_at IS NULL
        RETURNING id::TEXT`,
      [id, scope.tenantId, scope.organizationId, actorUserId],
    );
    return rows.length > 0;
  },
};

export { pool };
