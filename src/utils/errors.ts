export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHORIZATION_REQUIRED'
  | 'INVALID_BEARER_TOKEN'
  | 'FORBIDDEN'
  | 'USER_NOT_FOUND'
  | 'ROUTE_NOT_FOUND'
  | 'USER_EMAIL_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_NOT_READY';

export interface ErrorDetail {
  field?: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'AppError';
  }

  static validation(message: string, details: ErrorDetail[] = []) {
    return new AppError(400, 'VALIDATION_ERROR', message, details);
  }
  static userNotFound() {
    return new AppError(404, 'USER_NOT_FOUND', 'User not found within current security scope');
  }
  static forbidden(message = 'Actor is not permitted to perform this operation') {
    return new AppError(403, 'FORBIDDEN', message);
  }
}
