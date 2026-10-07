import { logger } from './logger';

export interface AuditEvent {
  event: 'user.created' | 'user.updated' | 'user.status_changed' | 'user.deleted';
  tenantId: string;
  organizationId: string;
  actorUserId: string;
  targetUserId: string;
  requestId: string;
  changedFields: string[];
  result: 'success';
}

/**
 * Emits a structured audit event (Report 14.2). V1 writes it to the structured log stream so a
 * central Audit Service / log shipper can pick it up; swap this for an outbox publisher later.
 */
export function emitAudit(evt: AuditEvent): void {
  logger.info('audit', { audit: evt });
}
