import type { Context } from 'hono';
import type { AppEnv } from '../types.ts';

export interface AuditEntry {
  userId: string;
  action: string;            // e.g. auth.login, campaign.create
  targetType?: string;
  targetId?: string;
  detail?: unknown;
  ip?: string | null;
}

export async function writeAudit(db: D1Database, e: AuditEntry) {
  await db
    .prepare(
      'INSERT INTO audit_log (user_id, action, target_type, target_id, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      e.userId,
      e.action,
      e.targetType ?? null,
      e.targetId ?? null,
      e.detail === undefined ? null : JSON.stringify(e.detail),
      e.ip ?? null,
      new Date().toISOString()
    )
    .run();
}

/** Audit helper bound to the current request's user and IP. Call from any admin write. */
export function audit(c: Context<AppEnv>, action: string, target?: { type: string; id: string }, detail?: unknown) {
  return writeAudit(c.env.DB, {
    userId: c.get('user').id,
    action,
    targetType: target?.type,
    targetId: target?.id,
    detail,
    ip: c.req.header('cf-connecting-ip') ?? null
  });
}
