import { PoolClient } from 'pg';
import { Scope, UserDto } from '../types';

export interface StoredIdempotency {
  requestHash: string;
  response: UserDto | null;
}

export const idempotencyRepository = {
  /**
   * Atomically claims a key. Returns true when this request owns the key (new, or an expired record
   * that was recycled). Returns false when a live record already exists. A concurrent claimant blocks
   * on the primary key until the other transaction commits or rolls back, so there is no race.
   */
  async claim(client: PoolClient, scope: Scope, key: string, requestHash: string, ttlHours: number): Promise<boolean> {
    const { rowCount } = await client.query(
      `INSERT INTO idempotency_keys (tenant_id, organization_id, idem_key, request_hash)
       VALUES ($1::BIGINT, $2::BIGINT, $3, $4)
       ON CONFLICT (tenant_id, organization_id, idem_key) DO UPDATE
         SET request_hash = EXCLUDED.request_hash, user_id = NULL, response = NULL, created_at = NOW()
         WHERE idempotency_keys.created_at < NOW() - make_interval(hours => $5::INT)`,
      [scope.tenantId, scope.organizationId, key, requestHash, ttlHours],
    );
    return (rowCount ?? 0) === 1;
  },

  async find(client: PoolClient, scope: Scope, key: string): Promise<StoredIdempotency | null> {
    const { rows } = await client.query(
      `SELECT request_hash AS "requestHash", response
         FROM idempotency_keys
        WHERE tenant_id = $1::BIGINT AND organization_id = $2::BIGINT AND idem_key = $3`,
      [scope.tenantId, scope.organizationId, key],
    );
    return rows[0] ?? null;
  },

  async complete(client: PoolClient, scope: Scope, key: string, user: UserDto): Promise<void> {
    await client.query(
      `UPDATE idempotency_keys
          SET user_id = $4::BIGINT, response = $5::JSONB
        WHERE tenant_id = $1::BIGINT AND organization_id = $2::BIGINT AND idem_key = $3`,
      [scope.tenantId, scope.organizationId, key, user.id, JSON.stringify(user)],
    );
  },

  /** Housekeeping: removes records past retention. Safe to call periodically. */
  async purgeExpired(client: PoolClient, ttlHours: number): Promise<number> {
    const { rowCount } = await client.query(
      `DELETE FROM idempotency_keys WHERE created_at < NOW() - make_interval(hours => $1::INT)`,
      [ttlHours],
    );
    return rowCount ?? 0;
  },
};
