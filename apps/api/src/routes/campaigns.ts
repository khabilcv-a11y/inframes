import { Hono } from 'hono';
import { campaignActionSchema, createCampaignSchema, updateCampaignSchema } from '@inframe/shared';
import type { AppEnv } from '../types.ts';
import { canAccessOrg, requireAuth, requireRole } from '../middleware/auth.ts';
import { audit } from '../lib/audit.ts';
import { effectiveState } from '../lib/campaign-state.ts';
import { ulid } from '../lib/ids.ts';

export const campaigns = new Hono<AppEnv>();
campaigns.use('*', requireAuth());

export interface Row {
  id: string; org_id: string; short_code: string; title: string; description: string | null; language: string;
  starts_at: string; ends_at: string; daily_window: string | null; status: string; caption: string | null;
  hashtags: string | null; thank_you: string | null; cta_url: string | null; created_at: string; updated_at: string;
  save_mode?: string; org_name?: string; logo_image_id?: string | null; org_logo_image_id?: string | null; org_logo_url?: string | null;
}

const present = (r: Row) => ({
  id: r.id, orgId: r.org_id, orgName: r.org_name, shortCode: r.short_code, title: r.title,
  description: r.description, language: r.language, startsAt: r.starts_at, endsAt: r.ends_at,
  dailyWindow: r.daily_window ? JSON.parse(r.daily_window) : null, storedStatus: r.status,
  state: effectiveState(r), caption: r.caption, hashtags: r.hashtags, thankYou: r.thank_you,
  ctaUrl: r.cta_url, createdAt: r.created_at, updatedAt: r.updated_at, logoUrl: logoOf(r), ownLogo: !!r.logo_image_id, saveMode: r.save_mode ?? 'off',
  orgLogoUrl: r.org_logo_image_id ? `/api/images/${r.org_logo_image_id}` : r.org_logo_url ?? null
});

export const SELECT = 'SELECT k.*, o.name AS org_name, o.logo_image_id AS org_logo_image_id, o.logo_url AS org_logo_url FROM campaigns k JOIN organisations o ON o.id = k.org_id';
export const logoOf = (r: Row) => r.logo_image_id ? `/api/images/${r.logo_image_id}` : r.org_logo_image_id ? `/api/images/${r.org_logo_image_id}` : r.org_logo_url ?? null;
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

async function uniqueCode(db: D1Database): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = newCode();
    if (!(await db.prepare('SELECT id FROM campaigns WHERE short_code = ?').bind(code).first())) return code;
  }
  throw new Error('could not allocate short code');
}

campaigns.get('/', async (c) => {
  const u = c.get('user');
  const q = u.role === 'super_admin' ? c.env.DB.prepare(`${SELECT} ORDER BY k.created_at DESC`) : c.env.DB.prepare(`${SELECT} WHERE k.org_id = ? ORDER BY k.created_at DESC`).bind(u.org_id);
  const { results } = await q.all<Row>();
  return c.json({ campaigns: results.map(present) });
});

campaigns.get('/:id', async (c) => {
  const r = await c.env.DB.prepare(`${SELECT} WHERE k.id = ?`).bind(c.req.param('id')).first<Row>();
  if (!r || !canAccessOrg(c.get('user'), r.org_id)) return c.json({ error: 'not_found' }, 404);
  return c.json({ campaign: present(r) });
});

campaigns.post('/', requireRole('super_admin', 'manager'), async (c) => {
  const p = createCampaignSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'invalid_input', issues: p.error.issues }, 400);
  const d = p.data;
  const u = c.get('user');
  const orgId = u.role === 'super_admin' ? d.orgId : u.org_id;
  if (!orgId) return c.json({ error: 'org_required' }, 400);
  if (!(await c.env.DB.prepare("SELECT id FROM organisations WHERE id = ? AND status = 'active'").bind(orgId).first())) {
    return c.json({ error: 'org_not_found' }, 404);
  }
  const code = d.shortCode ?? (await uniqueCode(c.env.DB));
  if (d.shortCode && (await c.env.DB.prepare('SELECT id FROM campaigns WHERE short_code = ?').bind(code).first())) {
    return c.json({ error: 'code_taken' }, 409);
  }
  const id = ulid();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO campaigns (id, org_id, short_code, title, description, language, starts_at, ends_at, daily_window,
       status, caption, hashtags, thank_you, cta_url, save_mode, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?)`
  )
    .bind(id, orgId, code, d.title, d.description ?? null, d.language, new Date(d.startsAt).toISOString(), new Date(d.endsAt).toISOString(),
      d.dailyWindow ? JSON.stringify(d.dailyWindow) : null, d.caption ?? null, d.hashtags ?? null, d.thankYou ?? null, d.ctaUrl ?? null, d.saveMode ?? 'off', u.id, now, now)
    .run();
  await audit(c, 'campaign.create', { type: 'campaign', id }, { title: d.title, shortCode: code });
  return c.json({ id, shortCode: code }, 201);
});

campaigns.patch('/:id', requireRole('super_admin', 'manager'), async (c) => {
  const p = updateCampaignSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'invalid_input', issues: p.error.issues }, 400);
  const id = c.req.param('id');
  const r = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first<Row>();
  if (!r || !canAccessOrg(c.get('user'), r.org_id)) return c.json({ error: 'not_found' }, 404);
  const d = p.data;
  const startsAt = d.startsAt ? new Date(d.startsAt).toISOString() : r.starts_at;
  const endsAt = d.endsAt ? new Date(d.endsAt).toISOString() : r.ends_at;
  if (new Date(endsAt) <= new Date(startsAt)) return c.json({ error: 'invalid_input' }, 400);
  if (d.shortCode && d.shortCode !== r.short_code) {
    if (await c.env.DB.prepare('SELECT id FROM campaigns WHERE short_code = ?').bind(d.shortCode).first()) return c.json({ error: 'code_taken' }, 409);
  }
  const pick = <T>(v: T | undefined, old: T | null) => (v === undefined ? old : v);
  await c.env.DB.prepare(
    `UPDATE campaigns SET title=?, description=?, language=?, starts_at=?, ends_at=?, daily_window=?, caption=?, hashtags=?,
       thank_you=?, cta_url=?, short_code=?, save_mode=?, updated_at=? WHERE id=?`
  )
    .bind(pick(d.title, r.title), pick(d.description, r.description), pick(d.language, r.language), startsAt, endsAt,
      d.dailyWindow === undefined ? r.daily_window : d.dailyWindow ? JSON.stringify(d.dailyWindow) : null,
      pick(d.caption, r.caption), pick(d.hashtags, r.hashtags), pick(d.thankYou, r.thank_you), pick(d.ctaUrl, r.cta_url),
      pick(d.shortCode, r.short_code), pick(d.saveMode, r.save_mode ?? 'off'), new Date().toISOString(), id)
    .run();
  await audit(c, 'campaign.update', { type: 'campaign', id }, Object.keys(d));
  return c.json({ ok: true });
});

// What each action needs the campaign's current state to be, and what it stores.
const TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  publish: { from: ['draft'], to: 'scheduled' },
  pause: { from: ['scheduled', 'live'], to: 'paused' },
  resume: { from: ['paused'], to: 'scheduled' },
  end: { from: ['scheduled', 'live', 'paused'], to: 'ended' },
  archive: { from: ['draft', 'ended'], to: 'archived' }
};

campaigns.post('/:id/state', requireRole('super_admin', 'manager'), async (c) => {
  const p = campaignActionSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'invalid_input' }, 400);
  const id = c.req.param('id');
  const r = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first<Row>();
  if (!r || !canAccessOrg(c.get('user'), r.org_id)) return c.json({ error: 'not_found' }, 404);
  const state = effectiveState(r);
  const t = TRANSITIONS[p.data.action];
  if (!t.from.includes(state)) return c.json({ error: 'invalid_transition', state }, 409);
  await c.env.DB.prepare('UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?').bind(t.to, new Date().toISOString(), id).run();
  await audit(c, `campaign.${p.data.action}`, { type: 'campaign', id });
  return c.json({ ok: true });
});
