import { createMiddleware } from 'hono/factory';
import type { Role } from '@inframe/shared';
import type { AppEnv, UserRow } from '../types.ts';
import { issueSession, readSession } from '../lib/session.ts';

/**
 * Loads the user behind the session cookie. Status is checked against the database on every
 * request so suspending an admin takes effect immediately, and the cookie is re-issued so the
 * 12-hour expiry is idle-based (sliding).
 */
export const requireAuth = (opts: { allowPasswordChangePending?: boolean } = {}) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const userId = await readSession(c);
    if (!userId) return c.json({ error: 'unauthenticated' }, 401);

    const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<UserRow>();
    if (!user || user.status === 'suspended') return c.json({ error: 'unauthenticated' }, 401);

    if (user.must_change_password && !opts.allowPasswordChangePending) {
      return c.json({ error: 'password_change_required' }, 403);
    }

    c.set('user', user);
    await issueSession(c, user.id);
    await next();
  });

export const requireRole = (...roles: Role[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!roles.includes(c.get('user').role)) return c.json({ error: 'forbidden' }, 403);
    await next();
  });

/**
 * Scope guard for org-owned resources: super admin passes; others only for their own org.
 * Use as `orgScope(c.get('user'), resource.org_id)` inside handlers.
 */
export function canAccessOrg(user: UserRow, orgId: string): boolean {
  return user.role === 'super_admin' || user.org_id === orgId;
}
