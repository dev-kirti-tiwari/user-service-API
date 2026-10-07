-- Core users table (Report Appendix B). The migration runner wraps this file in a transaction.
CREATE TABLE users (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         BIGINT NOT NULL,
  organization_id   BIGINT NOT NULL,

  first_name        VARCHAR(100) NOT NULL,
  last_name         VARCHAR(100),
  email             VARCHAR(255),
  phone             VARCHAR(30),

  role_id           BIGINT,
  department_id     BIGINT,
  designation       VARCHAR(150),
  profile_image_url TEXT,

  status            VARCHAR(30) NOT NULL DEFAULT 'active',

  created_by        BIGINT,
  updated_by        BIGINT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ NULL,

  CONSTRAINT chk_users_status CHECK (status IN ('active', 'inactive', 'invited', 'suspended'))
);

CREATE INDEX idx_users_tenant_org
  ON users (tenant_id, organization_id);

CREATE INDEX idx_users_scope_status
  ON users (tenant_id, organization_id, status);

CREATE INDEX idx_users_scope_role
  ON users (tenant_id, organization_id, role_id);

CREATE INDEX idx_users_scope_department
  ON users (tenant_id, organization_id, department_id);

CREATE UNIQUE INDEX uq_users_scope_email
  ON users (tenant_id, organization_id, LOWER(email))
  WHERE deleted_at IS NULL AND email IS NOT NULL;
