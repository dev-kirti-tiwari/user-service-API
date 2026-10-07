-- Idempotency records for POST /api/v1/users (Report 20.1).
-- Scoped by tenant + organization; stores the normalized payload hash and the stored result.
CREATE TABLE idempotency_keys (
  tenant_id       BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  idem_key        VARCHAR(255) NOT NULL,
  request_hash    CHAR(64) NOT NULL,
  user_id         BIGINT,
  response        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, organization_id, idem_key)
);

CREATE INDEX idx_idempotency_created_at ON idempotency_keys (created_at);
