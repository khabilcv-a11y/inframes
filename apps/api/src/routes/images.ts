import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { canAccessOrg, requireAuth, requireRole } from '../middleware/auth.ts';
import { audit } from '../lib/audit.ts';
import { ulid } from '../lib/ids.ts';

export const images = new Hono<AppEnv>();
export const MAX_LOGO_BYTES = 300_000;

images.get('/images/:id', async (c) => {
  const a = await c.env.DB.prepare('SELECT content_type, data FROM images WHERE id = ?').bind(c.req.param('id')).first<{ content_type: string; data: ArrayBuffer | number[] }>();
  if (!a) return c.json({ error: 'not_found' }, 404);
  const data = a.data instanceof ArrayBuffer ? a.data : new Uint8Array(a.data).buffer;
  return new Response(data, { headers: { 'content-type': a.content_type, 'cache-control': 'public, max-age=31536000, immutable' } });
});

const admin = new Hono<AppEnv>();
admin.use('*', requireAuth(), requireRole('super_admin', 'manager'));

async function readLogo(c: { req: { formData: () => Promise<FormData> } }) {
  const form = await c.req.formData().catch(() => null);
  const f = form?.get('file');
  if (!(f instanceof File)) return { error: 'file_required' as const };
  if (!['image/png', 'image/webp', 'image/jpeg'].includes(f.type)) return { error: 'bad_file_type' as const };
  if (f.size > MAX_LOGO_BYTES) return { error: 'file_too_large' as const };
  return { file: f };
}

async function store(db: D1Database, table: 'organisations' | 'campaigns', id: string, f: File | null) {
  const old = await db.prepare(`SELECT logo_image_id AS i FROM ${table} WHERE id = ?`).bind(id).first<{ i: string | null }>();
  let imageId: string | null = null;
  if (f) {
    imageId = ulid();
    await db.prepare('INSERT INTO images (id, content_type, bytes, data, created_at) VALUES (?,?,?,?,?)').bind(imageId, f.type, f.size, await f.arrayBuffer(), new Date().toISOString()).run();
  }
  await db.prepare(`UPDATE ${table} SET logo_image_id = ? WHERE id = ?`).bind(imageId, id).run();
  if (old?.i) await db.prepare('DELETE FROM images WHERE id = ?').bind(old.i).run();
  return imageId;
}

admin.post('/organisations/:id/logo', async (c) => {
  const id = c.req.param('id');
  const u = c.get('user');
  const org = await c.env.DB.prepare('SELECT id FROM organisations WHERE id = ?').bind(id).first();
  if (!org || !canAccessOrg(u, id)) return c.json({ error: 'not_found' }, 404);
  const r = await readLogo(c);
  if ('error' in r) return c.json({ error: r.error }, r.error === 'file_too_large' ? 413 : 400);
  const imageId = await store(c.env.DB, 'organisations', id, r.file);
  await audit(c, 'org.logo', { type: 'organisation', id });
  return c.json({ url: `/api/images/${imageId}` });
});

admin.delete('/organisations/:id/logo', async (c) => {
  const id = c.req.param('id');
  if (!canAccessOrg(c.get('user'), id)) return c.json({ error: 'not_found' }, 404);
  await store(c.env.DB, 'organisations', id, null);
  await audit(c, 'org.logo_remove', { type: 'organisation', id });
  return c.json({ ok: true });
});

async function ownCampaign(c: { env: AppEnv['Bindings']; get: (k: 'user') => AppEnv['Variables']['user'] }, id: string) {
  const k = await c.env.DB.prepare('SELECT id, org_id FROM campaigns WHERE id = ?').bind(id).first<{ id: string; org_id: string }>();
  return k && canAccessOrg(c.get('user'), k.org_id) ? k : null;
}

admin.post('/campaigns/:id/logo', async (c) => {
  const k = await ownCampaign(c, c.req.param('id'));
  if (!k) return c.json({ error: 'not_found' }, 404);
  const r = await readLogo(c);
  if ('error' in r) return c.json({ error: r.error }, r.error === 'file_too_large' ? 413 : 400);
  const imageId = await store(c.env.DB, 'campaigns', k.id, r.file);
  await audit(c, 'campaign.logo', { type: 'campaign', id: k.id });
  return c.json({ url: `/api/images/${imageId}` });
});

admin.delete('/campaigns/:id/logo', async (c) => {
  const k = await ownCampaign(c, c.req.param('id'));
  if (!k) return c.json({ error: 'not_found' }, 404);
  await store(c.env.DB, 'campaigns', k.id, null);
  await audit(c, 'campaign.logo_remove', { type: 'campaign', id: k.id });
  return c.json({ ok: true });
});

images.route('/admin', admin);
