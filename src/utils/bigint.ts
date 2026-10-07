/** Positive decimal string that fits in a signed 64-bit PostgreSQL BIGINT. IDs are never coerced to Number. */
const MAX_BIGINT = 9223372036854775807n;
const PATTERN = /^[1-9][0-9]*$/;

export function isValidBigIntId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 19 || !PATTERN.test(value)) return false;
  return BigInt(value) <= MAX_BIGINT;
}
