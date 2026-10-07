import { describe, expect, it } from 'vitest';
import { hashPayload } from '../src/services/user.service';
import { isValidBigIntId } from '../src/utils/bigint';
import { AppError } from '../src/utils/errors';
import {
  validateCreate,
  validateId,
  validateIdempotencyKey,
  validateListQuery,
  validateStatus,
  validateUpdate,
} from '../src/validators/user.validator';

const fieldsOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return (e as AppError).details.map((d) => d.field);
  }
  throw new Error('expected validation to throw');
};

describe('BIGINT id validation', () => {
  it('accepts positive decimal strings up to int64 max', () => {
    expect(isValidBigIntId('1')).toBe(true);
    expect(isValidBigIntId('9007199254740999')).toBe(true); // > Number.MAX_SAFE_INTEGER
    expect(isValidBigIntId('9223372036854775807')).toBe(true);
  });
  it('rejects zero, signs, decimals, whitespace, overflow and non-strings', () => {
    for (const v of ['0', '-1', '+1', '1.5', ' 1', '1 ', '01', '', 'abc', '9223372036854775808', '1e3', 12, null, undefined]) {
      expect(isValidBigIntId(v)).toBe(false);
    }
  });
  it('validateId throws a 400 VALIDATION_ERROR', () => {
    expect(() => validateId('abc')).toThrowError(AppError);
  });
});

describe('create validation', () => {
  it('normalizes email, phone and whitespace', () => {
    const v = validateCreate({ firstName: '  Aman ', email: ' Aman@Company.COM ', phone: '+91 98765-43210', lastName: '  ' });
    expect(v.firstName).toBe('Aman');
    expect(v.email).toBe('aman@company.com');
    expect(v.phone).toBe('+919876543210');
    expect(v.lastName).toBeNull();
  });
  it('requires firstName', () => {
    expect(fieldsOf(() => validateCreate({}))).toContain('firstName');
    expect(fieldsOf(() => validateCreate({ firstName: '   ' }))).toContain('firstName');
  });
  it('rejects body attempts to override scope or actor', () => {
    for (const k of ['tenantId', 'organizationId', 'createdBy', 'id', 'deletedAt']) {
      expect(() => validateCreate({ firstName: 'A', [k]: '1' })).toThrowError(AppError);
    }
  });
  it('rejects numeric ids (must be strings) and bad values', () => {
    expect(() => validateCreate({ firstName: 'A', roleId: 20 })).toThrowError(AppError);
    expect(() => validateCreate({ firstName: 'A', email: 'nope' })).toThrowError(AppError);
    expect(() => validateCreate({ firstName: 'A', phone: 'abc' })).toThrowError(AppError);
    expect(() => validateCreate({ firstName: 'A', status: 'suspended' })).toThrowError(AppError);
    expect(() => validateCreate({ firstName: 'A', profileImageUrl: 'javascript:alert(1)' })).toThrowError(AppError);
  });
});

describe('update / status validation', () => {
  it('rejects empty and unknown-field bodies', () => {
    expect(() => validateUpdate({})).toThrowError(AppError);
    expect(() => validateUpdate({ status: 'active' })).toThrowError(AppError);
    expect(() => validateUpdate({ tenantId: '1' })).toThrowError(AppError);
  });
  it('keeps only supplied fields and allows null to clear', () => {
    expect(validateUpdate({ designation: 'X', phone: null })).toEqual({ designation: 'X', phone: null });
  });
  it('does not allow firstName to be cleared', () => {
    expect(() => validateUpdate({ firstName: null })).toThrowError(AppError);
  });
  it('status only accepts the four lifecycle values', () => {
    expect(validateStatus({ status: 'suspended' })).toBe('suspended');
    expect(() => validateStatus({ status: 'deleted' })).toThrowError(AppError);
    expect(() => validateStatus({})).toThrowError(AppError);
  });
});

describe('list query validation', () => {
  it('applies defaults', () => {
    expect(validateListQuery({})).toMatchObject({ page: 1, limit: 20, sortField: 'createdAt', sortDir: 'desc' });
  });
  it('caps limit at MAX_PAGE_SIZE', () => {
    expect(validateListQuery({ limit: '9999' }).limit).toBe(50);
  });
  it('rejects bad page/limit/sort/filters', () => {
    expect(() => validateListQuery({ page: '0' })).toThrowError(AppError);
    expect(() => validateListQuery({ limit: '-1' })).toThrowError(AppError);
    expect(() => validateListQuery({ page: 'x' })).toThrowError(AppError);
    expect(() => validateListQuery({ sort: 'password:asc' })).toThrowError(AppError);
    expect(() => validateListQuery({ sort: 'createdAt;DROP TABLE users' })).toThrowError(AppError);
    expect(() => validateListQuery({ sort: 'createdAt:sideways' })).toThrowError(AppError);
    expect(() => validateListQuery({ status: 'gone' })).toThrowError(AppError);
    expect(() => validateListQuery({ roleId: '1.5' })).toThrowError(AppError);
    expect(() => validateListQuery({ status: ['active', 'inactive'] })).toThrowError(AppError);
    expect(() => validateListQuery({ unknown: '1' })).toThrowError(AppError);
  });
  it('parses sort', () => {
    expect(validateListQuery({ sort: 'firstName:asc' })).toMatchObject({ sortField: 'firstName', sortDir: 'asc' });
  });
});

describe('idempotency', () => {
  it('hashes equivalent payloads identically regardless of key order', () => {
    expect(hashPayload({ a: 1, b: { c: 2, d: 3 } })).toBe(hashPayload({ b: { d: 3, c: 2 }, a: 1 }));
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
  });
  it('validates the key format', () => {
    expect(validateIdempotencyKey(undefined)).toBeUndefined();
    expect(validateIdempotencyKey('usr-create-20261007-001')).toBe('usr-create-20261007-001');
    expect(() => validateIdempotencyKey('has space')).toThrowError(AppError);
    expect(() => validateIdempotencyKey('')).toThrowError(AppError);
    expect(() => validateIdempotencyKey('x'.repeat(256))).toThrowError(AppError);
  });
});
