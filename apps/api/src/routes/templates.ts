import { Hono } from 'hono';
import { MAX_ASSET_BYTES, OUTPUT_SIZES, saveSlotsSchema, templateMetaSchema, updateTemplateSchema } from '@inframe/shared';
import type { AppEnv } from '../types.ts';
import { canAccessOrg, requireAuth, requireRole } from '../middleware/auth.ts';
import { audit } from '../lib/audit.ts';
import { ulid } from '../lib/ids.ts';

export const templates = new Hono<AppEnv>();

interface TemplateRow { id: string; campaign_id: string; name: string; width: number; height: number; asset_id: string; photo_window: string; sort_order: number }
interface SlotRow {
  id: string; template_id: string; label: string; input_type: string; options: string | null; fixed_value: string | null;
  required: number; box: string; style: string; max_chars: number; sort_order: number;
}

export const presentSlot = (s: SlotRow) => ({
  id: s.id, label: s.label, inputType: s.input_type, options: s.options ? JSON.parse(s.options) : [], fixedValue: s.fixed_value,
  required: !!s.required, box: JSON.parse(s.box), style: JSON.parse(s.style), maxChars: s.max_chars
});

export async function loadTemplates(db: D1Database, campaignId: string) {
  const { results: ts } = await db.prepare('SELECT * FROM templates WHERE campaign_id = ? ORDER BY sort_order, id').bind(campaignId).all<TemplateRow>();
  const { results: ss } = await db
    .prepare('SELECT s.* FROM text_slots s JOIN templates t ON t.id = s.template_id WHERE t.campaign_id = ? ORDER BY s.sort_order')
    .bind(campaignId)
    .all<SlotRow>();
  return ts.map((t) => ({
    id: t.id, name: t.name, width: t.width, height: t.height, assetUrl: `/api/assets/${t.asset_id}`,
    photoWindow: JSON.parse(t.photo_window), sortOrder: t.sort_order,
    slots: ss.filter((s) => s.template_id === t.id).map(presentSlot)
  }));
}

// Frame images are public (they are what participants see) and never change, so cache hard.
templates.get('/assets/:id', async (c) => {
  const a = await c.env.DB.prepare('SELECT content_type, data FROM assets WHERE id = ?').bind(c.req.param('id')).first<{ content_type: string; data: ArrayBuffer | number[] }>();
  if (!a) return c.json({ error: 'not_found' }, 404);
  const data = a.data instanceof ArrayBuffer ? a.data : new Uint8Array(a.data).buffer;
  return new Response(data, { headers: { 'content-type': a.content_type, 'cache-control': 'public, max-age=31536000, immutable' } });
});

const admin = new Hono<AppEnv>();
admin.use('*', requireAuth());

async function ownedCampaign(c: { env: AppEnv['Bindings']; get: (k: 'user') => AppEnv['Variables']['user'] }, id: string) {
  const r = await c.env.DB.prepare('SELECT id, org_id, status FROM campaigns WHERE id = ?').bind(id).first<{ id: string; org_id: string; status: string }>();
  return r && canAccessOrg(c.get('user'), r.org_id) ? r : null;
}

admin.get('/campaigns/:id/templates', async (c) => {
  if (!(await ownedCampaign(c, c.req.param('id')))) return c.json({ error: 'not_found' }, 404);
  return c.json({ templates: await loadTemplates(c.env.DB, c.req.param('id')) });
});

admin.post('/campaigns/:id/templates', requireRole('super_admin', 'manager'), async (c) => {
  const camp = await ownedCampaign(c, c.req.param('id'));
  if (!camp) return c.json({ error: 'not_found' }, 404);
  if (camp.status === 'archived') return c.json({ error: 'archived' }, 409);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File)) return c.json({ error: 'file_required' }, 400);
  if (!['image/png', 'image/webp'].includes(file.type)) return c.json({ error: 'bad_file_type' }, 400);
  if (file.size > MAX_ASSET_BYTES) return c.json({ error: 'file_too_large', maxBytes: MAX_ASSET_BYTES }, 413);

  const meta = templateMetaSchema.safeParse({
    name: form.get('name'), width: form.get('width'), height: form.get('height'), photoWindow: JSON.parse(String(form.get('photoWindow') ?? 'null'))
  });
  if (!meta.success) return c.json({ error: 'invalid_input', issues: meta.error.issues }, 400);
  const m = meta.data;
  if (!OUTPUT_SIZES.some((s) => s.width === m.width && s.height === m.height)) return c.json({ error: 'bad_size' }, 400);
  if (m.photoWindow.x + m.photoWindow.w > m.width || m.photoWindow.y + m.photoWindow.h > m.height) return c.json({ error: 'window_outside_frame' }, 400);

  const now = new Date().toISOString();
  const assetId = ulid();
  const id = ulid();
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM templates WHERE campaign_id = ?').bind(camp.id).first<{ n: number }>();
  await c.env.DB.prepare('INSERT INTO assets (id, campaign_id, content_type, bytes, data, created_at) VALUES (?,?,?,?,?,?)')
    .bind(assetId, camp.id, file.type, file.size, await file.arrayBuffer(), now).run();
  await c.env.DB.prepare('INSERT INTO templates (id, campaign_id, name, width, height, asset_id, photo_window, sort_order) VALUES (?,?,?,?,?,?,?,?)')
    .bind(id, camp.id, m.name, m.width, m.height, assetId, JSON.stringify(m.photoWindow), count?.n ?? 0).run();
  await audit(c, 'template.create', { type: 'template', id }, { campaign: camp.id, name: m.name });
  return c.json({ id }, 201);
});

async function ownedTemplate(c: Parameters<typeof ownedCampaign>[0], id: string) {
  const t = await c.env.DB.prepare('SELECT * FROM templates WHERE id = ?').bind(id).first<TemplateRow>();
  return t && (await ownedCampaign(c, t.campaign_id)) ? t : null;
}

admin.patch('/templates/:id', requireRole('super_admin', 'manager'), async (c) => {
  const p = updateTemplateSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'invalid_input' }, 400);
  const t = await ownedTemplate(c, c.req.param('id'));
  if (!t) return c.json({ error: 'not_found' }, 404);
  const w = p.data.photoWindow;
  if (w && (w.x + w.w > t.width || w.y + w.h > t.height)) return c.json({ error: 'window_outside_frame' }, 400);
  await c.env.DB.prepare('UPDATE templates SET name = COALESCE(?, name), photo_window = COALESCE(?, photo_window), sort_order = COALESCE(?, sort_order) WHERE id = ?')
    .bind(p.data.name ?? null, w ? JSON.stringify(w) : null, p.data.sortOrder ?? null, t.id).run();
  await audit(c, 'template.update', { type: 'template', id: t.id });
  return c.json({ ok: true });
});

admin.delete('/templates/:id', requireRole('super_admin', 'manager'), async (c) => {
  const t = await ownedTemplate(c, c.req.param('id'));
  if (!t) return c.json({ error: 'not_found' }, 404);
  if (await c.env.DB.prepare('SELECT id FROM outputs WHERE template_id = ? LIMIT 1').bind(t.id).first()) return c.json({ error: 'has_outputs' }, 409);
  await c.env.DB.prepare('DELETE FROM text_slots WHERE template_id = ?').bind(t.id).run();
  await c.env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(t.id).run();
  await c.env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(t.asset_id).run();
  await audit(c, 'template.delete', { type: 'template', id: t.id });
  return c.json({ ok: true });
});

admin.put('/templates/:id/slots', requireRole('super_admin', 'manager'), async (c) => {
  const p = saveSlotsSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'invalid_input', issues: p.error.issues }, 400);
  const t = await ownedTemplate(c, c.req.param('id'));
  if (!t) return c.json({ error: 'not_found' }, 404);
  for (const s of p.data.slots) {
    if (s.box.x + s.box.w > t.width || s.box.y + s.box.h > t.height) return c.json({ error: 'box_outside_frame' }, 400);
    if (s.inputType === 'dropdown' && !s.options?.length) return c.json({ error: 'dropdown_needs_options' }, 400);
    if (s.style.minSize > s.style.maxSize) return c.json({ error: 'invalid_input' }, 400);
  }
  await c.env.DB.prepare('DELETE FROM text_slots WHERE template_id = ?').bind(t.id).run();
  let i = 0;
  for (const s of p.data.slots) {
    await c.env.DB.prepare(
      'INSERT INTO text_slots (id, template_id, label, input_type, options, fixed_value, required, box, style, max_chars, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(ulid(), t.id, s.label, s.inputType, s.options ? JSON.stringify(s.options) : null, s.fixedValue ?? null, s.required ? 1 : 0,
      JSON.stringify(s.box), JSON.stringify(s.style), s.maxChars, i++).run();
  }
  await audit(c, 'template.slots', { type: 'template', id: t.id }, { count: p.data.slots.length });
  return c.json({ ok: true });
});

templates.route('/admin', admin);
