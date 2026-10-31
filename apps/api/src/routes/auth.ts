import { Hono } from 'hono';
import { changePasswordSchema, loginSchema, type SessionUser } from '@inframe/shared';
import type { AppEnv, UserRow } from '../types.ts';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../lib/crypto.ts';
import { clearSession, issueSession } from '../lib/session.ts';
import { audit, writeAudit } from '../lib/audit.ts';
import { requireAuth } from '../middleware/auth.ts';
import { turnstileOk } from '../lib/turnstile.ts';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export const toSessionUser = (u: UserRow): SessionUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  orgId: u.org_id,
  mustChangePassword: !!u.must_change_password
});

export const auth = new Hono<AppEnv>();

auth.post('/login', async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const { email, password, turnstileToken } = parsed.data;
  const ip = c.req.header('cf-connecting-ip') ?? null;

  if (!(await turnstileOk(c.env.TURNSTILE_SECRET, turnstileToken, ip))) {
    return c.json({ error: 'bot_check_failed' }, 400);
  }

  const bad = c.json({ error: 'invalid_credentials' }, 401);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  if (!user || !user.password_hash || user.status === 'suspended') {
    await burnPasswordCheck(password);
    return bad;
  }

  if (user.locked_until && user.locked_until > new Date().toISOString()) {
    return c.json({ error: 'account_locked', until: user.locked_until }, 423);
  }

  if (!(await verifyPassword(password, user.password_hash))) {
    const failed = user.failed_logins + 1;
    const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
    await c.env.DB.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
      .bind(lock ? 0 : failed, lock, user.id)
      .run();
    if (lock) await writeAudit(c.env.DB, { userId: user.id, action: 'auth.locked', ip, detail: { until: lock } });
    return bad;
  }

  await c.env.DB.prepare(
    "UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ?, status = CASE status WHEN 'invited' THEN 'active' ELSE status END WHERE id = ?"
  )
    .bind(new Date().toISOString(), user.id)
    .run();
  await issueSession(c, user.id);
  await writeAudit(c.env.DB, { userId: user.id, action: 'auth.login', ip });
  return c.json({ user: toSessionUser(user) });
});

auth.post('/logout', requireAuth({ allowPasswordChangePending: true }), async (c) => {
  await audit(c, 'auth.logout');
  clearSession(c);
  return c.json({ ok: true });
});

auth.get('/me', requireAuth({ allowPasswordChangePending: true }), (c) =>
  c.json({ user: toSessionUser(c.get('user')) })
);

auth.post('/change-password', requireAuth({ allowPasswordChangePending: true }), async (c) => {
  const parsed = changePasswordSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_input', issues: parsed.error.issues }, 400);

  const user = c.get('user');
  if (!user.password_hash || !(await verifyPassword(parsed.data.currentPassword, user.password_hash))) {
    return c.json({ error: 'invalid_credentials' }, 401);
  }
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .bind(await hashPassword(parsed.data.newPassword), user.id)
    .run();
  await audit(c, 'auth.change_password', { type: 'user', id: user.id });
  return c.json({ ok: true });
});
