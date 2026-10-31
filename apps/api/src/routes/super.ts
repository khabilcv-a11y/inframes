import { Hono } from 'hono';
import { createAdminSchema, createOrgSchema, updateAdminSchema, updateOrgSchema } from '@inframe/shared';
import type { AppEnv } from '../types.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { audit } from '../lib/audit.ts';
import { hashPassword } from '../lib/crypto.ts';
import { tempPassword, ulid } from '../lib/ids.ts';

export const superRoutes = new Hono<AppEnv>();
superRoutes.use('*', requireAuth(), requireRole('super_admin'));

const body = (c: { req: { json: () => Promise<unknown> } }) => c.req.json().catch(() => null);

// ---- Organisations ----
superRoutes.get('/organisations', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.name, o.logo_url AS logoUrl, o.status, o.created_at AS createdAt,
            (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) AS admins,
            (SELECT COUNT(*) FROM campaigns k WHERE k.org_id = o.id) AS campaigns
     FROM organisations o ORDER BY o.name`
  ).all();
  return c.json({ organisations: results });
});

superRoutes.post('/organisations', async (c) => {
  const p = createOrgSchema.safeParse(await body(c));
  if (!p.success) return c.json({ error: 'invalid_input', issues: p.error.issues }, 400);
  const id = ulid();
  await c.env.DB.prepare('INSERT INTO organisations (id, name, logo_url, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, p.data.name, p.data.logoUrl ?? null, new Date().toISOString())
    .run();
  await audit(c, 'org.create', { type: 'organisation', id }, { name: p.data.name });
  return c.json({ id }, 201);
});

superRoutes.patch('/organisations/:id', async (c) => {
  const p = updateOrgSchema.safeParse(await body(c));
  if (!p.success) return c.json({ error: 'invalid_input', issues: p.error.issues }, 400);
  const id = c.req.param('id');
  const found = await c.env.DB.prepare('SELECT id FROM organisations WHERE id = ?').bind(id).first();
  if (!found) return c.json({ error: 'not_found' }, 404);
  const d = p.data;
  await c.env.DB.prepare(
    'UPDATE organisations SET name = COALESCE(?, name), logo_url = CASE WHEN ? THEN ? ELSE logo_url END, status = COALESCE(?, status) WHERE id = ?'
  )
    .bind(d.name ?? null, d.logoUrl === undefined ? 0 : 1, d.logoUrl ?? null, d.status ?? null, id)
    .run();
  await audit(c, 'org.update', { type: 'organisation', id }, d);
  return c.json({ ok: true });
});

// ---- Admins ----
superRoutes.get('/admins', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.mobile, u.role, u.status, u.org_id AS orgId, o.name AS orgName,
            u.last_login_at AS lastLoginAt,
            (SELECT COUNT(*) FROM campaigns k WHERE k.created_by = u.id) AS campaigns
     FROM users u LEFT JOIN organisations o ON o.id = u.org_id
     WHERE u.role != 'super_admin' ORDER BY u.created_at DESC`
  ).all();
  return c.json({ admins: results });
});

superRoutes.post('/admins', async (c) => {
  const p = createAdminSchema.safeParse(await body(c));
  if (!p.success) return c.json({ error: 'invalid_input', issues: p.error.issues }, 400);
  const d = p.data;
  const org = await c.env.DB.prepare("SELECT id FROM organisations WHERE id = ? AND status = 'active'").bind(d.orgId).first();
  if (!org) return c.json({ error: 'org_not_found' }, 404);
  if (await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(d.email).first()) {
    return c.json({ error: 'email_taken' }, 409);
  }
  const id = ulid();
  const password = tempPassword();
  await c.env.DB.prepare(
    `INSERT INTO users (id, org_id, name, email, mobile, role, password_hash, status, must_change_password, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'invited', 1, ?, ?)`
  )
    .bind(id, d.orgId, d.name, d.email, d.mobile ?? null, d.role, await hashPassword(password), c.get('user').id, new Date().toISOString())
    .run();
  await audit(c, 'admin.create', { type: 'user', id }, { email: d.email, role: d.role, orgId: d.orgId });
  // Shown once. Email delivery of invites comes later; for now the super admin passes this on.
  return c.json({ id, temporaryPassword: password }, 201);
});

superRoutes.patch('/admins/:id', async (c) => {
  const p = updateAdminSchema.safeParse(await body(c));
  if (!p.success) return c.json({ error: 'invalid_input', issues: p.error.issues }, 400);
  const id = c.req.param('id');
  const target = await c.env.DB.prepare("SELECT id, status FROM users WHERE id = ? AND role != 'super_admin'").bind(id).first<{ status: string }>();
  if (!target) return c.json({ error: 'not_found' }, 404);
  const { action, role, orgId } = p.data;

  if (orgId && !(await c.env.DB.prepare("SELECT id FROM organisations WHERE id = ? AND status = 'active'").bind(orgId).first())) {
    return c.json({ error: 'org_not_found' }, 404);
  }
  if (role || orgId) {
    await c.env.DB.prepare('UPDATE users SET role = COALESCE(?, role), org_id = COALESCE(?, org_id) WHERE id = ?')
      .bind(role ?? null, orgId ?? null, id)
      .run();
    await audit(c, 'admin.update', { type: 'user', id }, { role, orgId });
  }
  if (action === 'suspend' || action === 'reactivate') {
    // Reactivating an admin who never logged in goes back to 'invited'.
    const next = action === 'suspend' ? 'suspended' : 'active';
    await c.env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(next, id).run();
    await audit(c, `admin.${action}`, { type: 'user', id });
  }
  if (action === 'reset_password') {
    const password = tempPassword();
    await c.env.DB.prepare(
      'UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL WHERE id = ?'
    )
      .bind(await hashPassword(password), id)
      .run();
    await audit(c, 'admin.reset_password', { type: 'user', id });
    return c.json({ ok: true, temporaryPassword: password });
  }
  return c.json({ ok: true });
});
