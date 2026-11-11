import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types.ts';
import { canAccessOrg, requireAuth, requireRole } from '../middleware/auth.ts';
import { audit } from '../lib/audit.ts';
import { ulid } from '../lib/ids.ts';

export const photos = new Hono<AppEnv>();

export const EMB = 128;                  // numbers per face signature
const MAX_FACES = 60;                    // per photo
const THUMB_MAX = 80_000, VIEW_MAX = 1_200_000;
const MAX_PHOTOS = 2000;                 // per campaign
export const RETENTION_MONTHS = 31;
export const STRONG = 0.6, POSSIBLE = 0.48; // cosine similarity cut-offs (see docs/SPEC.md)

const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const asBytes = (v: ArrayBuffer | number[] | Uint8Array | null) => (v == null ? null : v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBuffer));

/** Event photos are deleted 31 months after they were added. Runs on the way past; costs one indexed query. */
async function expire(db: D1Database) {
  const cut = new Date(); cut.setUTCMonth(cut.getUTCMonth() - RETENTION_MONTHS);
  const iso = cut.toISOString();
  const old = await db.prepare('SELECT id FROM event_photos WHERE created_at < ? LIMIT 50').bind(iso).all<{ id: string }>();
  for (const r of old.results) {
    await db.prepare('DELETE FROM event_photo_files WHERE photo_id = ?').bind(r.id).run();
    await db.prepare('DELETE FROM event_photos WHERE id = ?').bind(r.id).run();
  }
}

// ---------- organiser ----------
const admin = new Hono<AppEnv>();
admin.use('*', requireAuth());

async function owned(c: { env: AppEnv['Bindings']; get: (k: 'user') => AppEnv['Variables']['user'] }, id: string) {
  const k = await c.env.DB.prepare('SELECT id, org_id, short_code FROM campaigns WHERE id = ?').bind(id).first<{ id: string; org_id: string; short_code: string }>();
  return k && canAccessOrg(c.get('user'), k.org_id) ? k : null;
}

admin.get('/campaigns/:id/photos', async (c) => {
  const k = await owned(c, c.req.param('id'));
  if (!k) return c.json({ error: 'not_found' }, 404);
  await expire(c.env.DB);
  const { results } = await c.env.DB.prepare('SELECT id, name, faces, created_at AS createdAt FROM event_photos WHERE campaign_id = ? ORDER BY name').bind(k.id).all<{ id: string; name: string; faces: number; createdAt: string }>();
  return c.json({ photos: results, total: results.length, faces: results.reduce((n, r) => n + r.faces, 0), retentionMonths: RETENTION_MONTHS });
});

// One photo: a small preview, a web-size copy, and the face signatures the organiser's browser worked out.
admin.post('/campaigns/:id/photos', requireRole('super_admin', 'manager'), async (c) => {
  const k = await owned(c, c.req.param('id'));
  if (!k) return c.json({ error: 'not_found' }, 404);
  const form = await c.req.formData().catch(() => null);
  const thumb = form?.get('thumb'), view = form?.get('view');
  if (!form || !(thumb instanceof File) || !(view instanceof File)) return c.json({ error: 'file_required' }, 400);
  if (thumb.type !== 'image/jpeg' || view.type !== 'image/jpeg') return c.json({ error: 'bad_file_type' }, 400);
  if (thumb.size > THUMB_MAX || view.size > VIEW_MAX) return c.json({ error: 'file_too_large' }, 413);
  const meta = z.object({ name: z.string().trim().min(1).max(200), width: z.coerce.number().int().min(1).max(20000), height: z.coerce.number().int().min(1).max(20000), embs: z.string().max(MAX_FACES * EMB * 4 * 1.4) })
    .safeParse({ name: form.get('name'), width: form.get('width'), height: form.get('height'), embs: form.get('embs') ?? '' });
  if (!meta.success) return c.json({ error: 'invalid_input' }, 400);
  const embs = b64ToBytes(meta.data.embs);
  if (embs.length % (EMB * 4) !== 0) return c.json({ error: 'invalid_input' }, 400);

  if (await c.env.DB.prepare('SELECT id FROM event_photos WHERE campaign_id = ? AND name = ?').bind(k.id, meta.data.name).first()) return c.json({ error: 'duplicate' }, 409);
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM event_photos WHERE campaign_id = ?').bind(k.id).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_PHOTOS) return c.json({ error: 'too_many' }, 409);

  const id = ulid();
  await c.env.DB.prepare('INSERT INTO event_photos (id, campaign_id, name, width, height, faces, embs, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(id, k.id, meta.data.name, meta.data.width, meta.data.height, embs.length / (EMB * 4), embs.length ? embs.buffer : null, new Date().toISOString()).run();
  await c.env.DB.prepare('INSERT INTO event_photo_files (photo_id, kind, data) VALUES (?,?,?), (?,?,?)')
    .bind(id, 'thumb', await thumb.arrayBuffer(), id, 'view', await view.arrayBuffer()).run();
  return c.json({ id }, 201);
});

admin.delete('/campaigns/:id/photos', requireRole('super_admin', 'manager'), async (c) => {
  const k = await owned(c, c.req.param('id'));
  if (!k) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare('DELETE FROM event_photo_files WHERE photo_id IN (SELECT id FROM event_photos WHERE campaign_id = ?)').bind(k.id).run();
  await c.env.DB.prepare('DELETE FROM event_photos WHERE campaign_id = ?').bind(k.id).run();
  await audit(c, 'photos.delete_all', { type: 'campaign', id: k.id });
  return c.json({ ok: true });
});

admin.delete('/photos/:pid', requireRole('super_admin', 'manager'), async (c) => {
  const p = await c.env.DB.prepare('SELECT id, campaign_id FROM event_photos WHERE id = ?').bind(c.req.param('pid')).first<{ id: string; campaign_id: string }>();
  if (!p || !(await owned(c, p.campaign_id))) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare('DELETE FROM event_photo_files WHERE photo_id = ?').bind(p.id).run();
  await c.env.DB.prepare('DELETE FROM event_photos WHERE id = ?').bind(p.id).run();
  return c.json({ ok: true });
});

// Reading a Drive folder that is shared as "Anyone with the link" (no Google sign-in or script needed).
const DRIVE_ID = /^[A-Za-z0-9_-]{10,80}$/;
const unescapeHtml = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

admin.get('/drive-folder', requireRole('super_admin', 'manager'), async (c) => {
  const id = (/folders\/([A-Za-z0-9_-]+)/.exec(c.req.query('url') ?? '')?.[1]) ?? c.req.query('url') ?? '';
  if (!DRIVE_ID.test(id)) return c.json({ error: 'bad_url' }, 400);
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${id}`);
  if (!res.ok) return c.json({ error: 'not_shared' }, 409);
  const html = await res.text();
  const ids = [...html.matchAll(/id="entry-([\w-]+)"/g)].map((m) => m[1]);
  const names = [...html.matchAll(/class="flip-entry-title">([^<]*)</g)].map((m) => unescapeHtml(m[1]));
  const files = ids.map((fid, i) => ({ id: fid, name: names[i] ?? fid })).filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f.name));
  if (!ids.length) return c.json({ error: 'not_shared' }, 409);
  return c.json({ files });
});

admin.get('/drive-file/:fid', requireRole('super_admin', 'manager'), async (c) => {
  const fid = c.req.param('fid');
  if (!DRIVE_ID.test(fid)) return c.json({ error: 'bad_url' }, 400);
  const res = await fetch(`https://drive.google.com/uc?export=download&id=${fid}`);
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.startsWith('image/')) return c.json({ error: 'not_shared' }, 409);
  return new Response(res.body, { headers: { 'content-type': type, 'cache-control': 'private, max-age=600' } });
});

photos.route('/admin', admin);

// ---------- participant ----------
async function publicCampaign(db: D1Database, code: string) {
  const k = await db.prepare('SELECT id, status FROM campaigns WHERE short_code = ?').bind(code.toLowerCase()).first<{ id: string; status: string }>();
  return k && k.status !== 'draft' && k.status !== 'archived' ? k : null;
}

photos.get('/c/:code/photos/info', async (c) => {
  const k = await publicCampaign(c.env.DB, c.req.param('code'));
  if (!k) return c.json({ error: 'not_found' }, 404);
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM event_photos WHERE campaign_id = ?').bind(k.id).first<{ n: number }>();
  return c.json({ photos: n?.n ?? 0 });
});

/**
 * The phone sends only the selfie's face signature (128 numbers), never the selfie. Matching happens here so
 * nobody can download other people's signatures or browse the whole event.
 */
photos.post('/c/:code/photos/match', async (c) => {
  const p = z.object({ emb: z.array(z.number().finite()).length(EMB) }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'invalid_input' }, 400);
  const k = await publicCampaign(c.env.DB, c.req.param('code'));
  if (!k) return c.json({ error: 'not_found' }, 404);
  await expire(c.env.DB);
  const q = new Float32Array(p.data.emb);
  let norm = 0; for (const v of q) norm += v * v; norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMB; i++) q[i] /= norm;

  const { results } = await c.env.DB.prepare('SELECT id, name, embs FROM event_photos WHERE campaign_id = ? AND faces > 0').bind(k.id).all<{ id: string; name: string; embs: ArrayBuffer | number[] }>();
  const out: { id: string; name: string; score: number }[] = [];
  for (const r of results) {
    const bytes = asBytes(r.embs);
    if (!bytes) continue;
    const f = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    let best = -1;
    for (let o = 0; o + EMB <= f.length; o += EMB) {
      let s = 0;
      for (let i = 0; i < EMB; i++) s += q[i] * f[o + i];
      if (s > best) best = s;
    }
    if (best >= POSSIBLE) out.push({ id: r.id, name: r.name, score: Math.round(best * 1000) / 1000 });
  }
  out.sort((a, b) => b.score - a.score);
  c.header('cache-control', 'no-store');
  return c.json({ strong: out.filter((x) => x.score >= STRONG), possible: out.filter((x) => x.score < STRONG).slice(0, 40), searched: results.length });
});

// Pictures are fetched by their own unguessable id (the id is only handed out to someone whose selfie matched).
photos.get('/photos/:pid/:kind', async (c) => {
  const kind = c.req.param('kind');
  if (kind !== 'thumb' && kind !== 'view') return c.json({ error: 'not_found' }, 404);
  const f = await c.env.DB.prepare('SELECT f.data, p.name FROM event_photo_files f JOIN event_photos p ON p.id = f.photo_id WHERE f.photo_id = ? AND f.kind = ?').bind(c.req.param('pid'), kind).first<{ data: ArrayBuffer | number[]; name: string }>();
  const bytes = asBytes(f?.data ?? null);
  if (!f || !bytes) return c.json({ error: 'not_found' }, 404);
  const headers: Record<string, string> = { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400' };
  if (c.req.query('download')) headers['content-disposition'] = `attachment; filename="${f.name.replace(/[^\w. -]+/g, '_').replace(/\.[^.]+$/, '')}.jpg"`;
  return new Response(bytes as unknown as BodyInit, { headers });
});
