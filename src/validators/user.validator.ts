import { z, ZodError, ZodTypeAny } from 'zod';
import { env } from '../config/env';
import {
  CreateUserInput,
  ListUsersQuery,
  SORT_FIELDS,
  SortField,
  UpdateUserInput,
  USER_STATUSES,
  UserStatus,
} from '../types';
import { isValidBigIntId } from '../utils/bigint';
import { AppError, ErrorDetail } from '../utils/errors';

// ---------- helpers ----------

function toDetails(err: ZodError): ErrorDetail[] {
  return err.issues.map((issue) => {
    if (issue.code === 'unrecognized_keys') {
      return { field: issue.keys.join(', '), message: `Unsupported field(s): ${issue.keys.join(', ')}` };
    }
    return { field: issue.path.join('.') || undefined, message: issue.message };
  });
}

/** Parses with a zod schema and converts failures to the standard 400 VALIDATION_ERROR. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown, what = 'request'): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw AppError.validation(`Invalid ${what}`, toDetails(result.error));
  }
  return result.data;
}

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

const idString = z
  .string({ invalid_type_error: 'must be a decimal string', required_error: 'is required' })
  .refine(isValidBigIntId, 'must be a positive integer string (max 9223372036854775807)');

const nullableId = z.preprocess(blankToNull, idString.nullable().optional());

const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max, `must be at most ${max} characters`).nullable().optional());

const email = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .toLowerCase()
    .max(255, 'must be at most 255 characters')
    .email('must be a valid email address')
    .nullable()
    .optional(),
);

/** Strips common separators; accepts an optional leading + and 7-15 digits (E.164 length bounds). */
const phone = z.preprocess(
  (v) => {
    const b = blankToNull(v);
    return typeof b === 'string' ? b.replace(/[\s\-().]/g, '') : b;
  },
  z
    .string()
    .regex(/^\+?[0-9]{7,15}$/, 'must contain 7-15 digits with an optional leading +')
    .nullable()
    .optional(),
);

const profileImageUrl = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .max(2048, 'must be at most 2048 characters')
    .refine((v) => {
      try {
        const u = new URL(v);
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'must be a valid http(s) URL')
    .nullable()
    .optional(),
);

const firstName = z
  .string({ required_error: 'is required', invalid_type_error: 'must be a string' })
  .trim()
  .min(1, 'must not be empty')
  .max(100, 'must be at most 100 characters');

// ---------- schemas ----------

export const idParamSchema = idString;

export const createUserSchema = z
  .object({
    firstName,
    lastName: optionalText(100),
    email,
    phone,
    roleId: nullableId,
    departmentId: nullableId,
    designation: optionalText(150),
    profileImageUrl,
    status: z.enum(['active', 'invited']).optional(),
  })
  .strict();

export const updateUserSchema = z
  .object({
    firstName: firstName.optional(),
    lastName: optionalText(100),
    email,
    phone,
    roleId: nullableId,
    departmentId: nullableId,
    designation: optionalText(150),
    profileImageUrl,
  })
  .strict()
  .refine((o) => Object.values(o).some((v) => v !== undefined), {
    message: 'At least one updatable field is required',
  });

export const statusSchema = z
  .object({ status: z.enum(USER_STATUSES, { errorMap: () => ({ message: `must be one of: ${USER_STATUSES.join(', ')}` }) }) })
  .strict();

const singleString = (name: string) => z.string({ invalid_type_error: `${name} must be provided once` });

export const listQuerySchema = z
  .object({
    page: singleString('page').regex(/^[0-9]+$/, 'must be an integer').optional(),
    limit: singleString('limit').regex(/^[0-9]+$/, 'must be an integer').optional(),
    status: z.enum(USER_STATUSES).optional(),
    roleId: idString.optional(),
    departmentId: idString.optional(),
    search: singleString('search').trim().max(100, 'must be at most 100 characters').optional(),
    sort: singleString('sort').optional(),
  })
  .strict();

export const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[\x21-\x7E]+$/, 'must be 1-255 printable ASCII characters without spaces');

// ---------- public validators ----------

export function validateId(raw: unknown, name = 'id'): string {
  if (!isValidBigIntId(raw)) {
    throw AppError.validation(`Invalid ${name}`, [
      { field: name, message: 'must be a positive integer string (max 9223372036854775807)' },
    ]);
  }
  return raw;
}

export function validateCreate(body: unknown): CreateUserInput {
  return parse(createUserSchema, body ?? {}, 'user payload') as CreateUserInput;
}

export function validateUpdate(body: unknown): UpdateUserInput {
  const parsed = parse(updateUserSchema, body ?? {}, 'update payload');
  // Drop undefined keys so only supplied fields reach the repository.
  return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined)) as UpdateUserInput;
}

export function validateStatus(body: unknown): UserStatus {
  return parse(statusSchema, body ?? {}, 'status payload').status;
}

export function validateIdempotencyKey(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const r = idempotencyKeySchema.safeParse(raw);
  if (!r.success) {
    throw AppError.validation('Invalid Idempotency-Key header', [{ field: 'Idempotency-Key', message: r.error.issues[0]?.message ?? 'invalid' }]);
  }
  return r.data;
}

export function validateListQuery(query: unknown): ListUsersQuery {
  const q = parse(listQuerySchema, query, 'query');

  const page = q.page === undefined ? 1 : Number(q.page);
  if (!Number.isSafeInteger(page) || page < 1) {
    throw AppError.validation('Invalid query', [{ field: 'page', message: 'must be an integer >= 1' }]);
  }
  const requestedLimit = q.limit === undefined ? Math.min(20, env.MAX_PAGE_SIZE) : Number(q.limit);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    throw AppError.validation('Invalid query', [{ field: 'limit', message: 'must be an integer >= 1' }]);
  }
  const limit = Math.min(requestedLimit, env.MAX_PAGE_SIZE);

  let sortField: SortField = 'createdAt';
  let sortDir: 'asc' | 'desc' = 'desc';
  if (q.sort !== undefined) {
    const [field, dir = 'asc', ...rest] = q.sort.split(':');
    if (rest.length || !(SORT_FIELDS as readonly string[]).includes(field as string) || !['asc', 'desc'].includes(dir)) {
      throw AppError.validation('Invalid query', [
        { field: 'sort', message: `must be <field>:<asc|desc> where field is one of: ${SORT_FIELDS.join(', ')}` },
      ]);
    }
    sortField = field as SortField;
    sortDir = dir as 'asc' | 'desc';
  }

  return {
    page,
    limit,
    status: q.status,
    roleId: q.roleId,
    departmentId: q.departmentId,
    search: q.search ? q.search : undefined,
    sortField,
    sortDir,
  };
}
