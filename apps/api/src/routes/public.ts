import { Hono } from 'hono';
import { eventsSchema, outputSchema } from '@inframe/shared';
import type { AppEnv, UserRow } from '../types.ts';
import { effectiveState } from '../lib/campaign-state.ts';
import { readSession } from '../lib/session.ts';
import { canAccessOrg } from '../middleware/auth.ts';
import { ulid } from '../lib/ids.ts';
import { turnstileOk } from '../lib/turnstile.ts';
import { loadTemplates } from './templates.ts';
import { SELECT, logoOf, type Row } from './campaigns.ts';
import { slugify } from '../lib/slug.ts';
import { scriptUrl } from '../lib/drive.ts';

export const publicRoutes = new Hono<AppEnv>();

const MAX_OUTPUTS_PER_VISITOR_PER_HOUR = 20;

interface Card {
  title: string; code: string; state: string; organisation: string; orgSlug: string; logoUrl: string | null;
  coverUrl: string | null; participants: number; endsAt: string;
}

/** Public campaign cards: frame thumbnail, organiser, supporter count. Two grouped queries for the whole list. */
async function cardsFor(db: D1Database, rows: Row[]): Promise<Card[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => '?').join(',');
  const { results: counts } = await db.prepare(`SELECT campaign_id AS id, COUNT(*) AS n FROM outputs WHERE campaign_id IN (${ph}) GROUP BY campaign_id`).bind(...ids).all<{ id: string; n: number }>();
  const { results: covers } = await db.prepare(`SELECT campaign_id AS id, asset_id FROM templates WHERE campaign_id IN (${ph}) AND kind != 'archived' ORDER BY sort_order DESC, id DESC`).bind(...ids).all<{ id: string; asset_id: string }>();
  const n = new Map(counts.map((c) => [c.id, c.n]));
  const cover = new Map(covers.map((c) => [c.id, `/api/assets/${c.asset_id}`])); // the first template wins (rows are ordered last-to-first)
  return rows.map((r) => ({
    title: r.title, code: r.short_code, state: effectiveState(r), organisation: r.org_name ?? '', orgSlug: slugify(r.org_name ?? ''),
    logoUrl: logoOf(r), coverUrl: cover.get(r.id) ?? null, participants: n.get(r.id) ?? 0, endsAt: r.ends_at
  }));
}
const visible = (r: Row) => r.status !== 'draft' && r.status !== 'archived';

async function findCampaign(c: { env: AppEnv['Bindings']; req: { param: (k: string) => string } }, code: string) {
  return c.env.DB.prepare(`${SELECT} WHERE k.short_code = ?`).bind(code.toLowerCase()).first<Row>();
}

/** Admins of the campaign's organisation may open a draft with ?preview=1 to test it. */
async function previewAllowed(c: Parameters<typeof readSession>[0], r: Row): Promise<boolean> {
  const id = await readSession(c);
  if (!id) return false;
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ? AND status != ?').bind(id, 'suspended').first<UserRow>();
  return !!u && canAccessOrg(u, r.org_id);
}

// Campaign page data (no login). Drafts and archived campaigns are hidden unless an org admin previews.
publicRoutes.get('/c/:code', async (c) => {
  const r = await findCampaign(c, c.req.param('code'));
  if (!r) return c.json({ error: 'not_found' }, 404);
  const preview = c.req.query('preview') === '1' && (await previewAllowed(c, r));
  if (!preview && (r.status === 'draft' || r.status === 'archived')) return c.json({ error: 'not_found' }, 404);

  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM outputs WHERE campaign_id = ?').bind(r.id).first<{ n: number }>();
  c.header('cache-control', preview ? 'no-store' : 'public, max-age=30');
  return c.json({
    title: r.title, description: r.description, language: r.language, organisation: r.org_name, orgSlug: slugify(r.org_name ?? ''), logoUrl: logoOf(r),
    state: preview ? 'live' : effectiveState(r), preview, startsAt: r.starts_at, endsAt: r.ends_at, caption: r.caption,
    hashtags: r.hashtags, thankYou: r.thank_you, ctaUrl: r.cta_url, outputs: n?.n ?? 0,
    saveMode: await effectiveSaveMode(c.env, r), templates: await loadTemplates(c.env.DB, r.id), more: await moreFrom(c.env.DB, r)
  });
});

/** The campaign's Drive setting, but 'off' unless a Drive script is connected (so no consent line for nothing). */
async function effectiveSaveMode(env: AppEnv['Bindings'], r: Row): Promise<string> {
  const mode = r.save_mode ?? 'off';
  if (mode === 'off') return 'off';
  return (await scriptUrl(env)) ? mode : 'off';
}

async function moreFrom(db: D1Database, r: Row): Promise<Card[]> {
  const { results } = await db.prepare(`${SELECT} WHERE k.org_id = ? AND k.id != ? ORDER BY k.created_at DESC LIMIT 12`).bind(r.org_id, r.id).all<Row>();
  return (await cardsFor(db, results.filter(visible))).slice(0, 6);
}

// A participant finished a frame. Only the typed values are saved (never the original photo).
publicRoutes.post('/c/:code/outputs', async (c) => {
  const p = outputSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'invalid_input' }, 400);
  const r = await findCampaign(c, c.req.param('code'));
  if (!r) return c.json({ error: 'not_found' }, 404);
  const preview = c.req.query('preview') === '1' && (await previewAllowed(c, r));
  if (preview) return c.json({ id: 'preview', serial: 0 });
  if (effectiveState(r) !== 'live') return c.json({ error: 'not_live' }, 409);
  if (!(await turnstileOk(c.env.TURNSTILE_SECRET, p.data.turnstileToken, c.req.header('cf-connecting-ip') ?? null))) return c.json({ error: 'bot_check_failed' }, 400);

  const t = await c.env.DB.prepare("SELECT id FROM templates WHERE id = ? AND campaign_id = ? AND kind != 'archived'").bind(p.data.templateId, r.id).first();
  if (!t) return c.json({ error: 'bad_template' }, 400);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM outputs WHERE campaign_id = ? AND visitor_id = ? AND created_at > ?')
    .bind(r.id, p.data.visitorId, since).first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_OUTPUTS_PER_VISITOR_PER_HOUR) return c.json({ error: 'rate_limited' }, 429);

  const id = ulid();
  await c.env.DB.prepare(
    `INSERT INTO outputs (id, campaign_id, template_id, serial, visitor_id, media_type, slot_values, path, created_at)
     SELECT ?, ?, ?, COALESCE(MAX(serial), 0) + 1, ?, 'photo', ?, 'photo', ? FROM outputs WHERE campaign_id = ?`
  ).bind(id, r.id, p.data.templateId, p.data.visitorId, JSON.stringify(p.data.slotValues), new Date().toISOString(), r.id).run();
  const row = await c.env.DB.prepare('SELECT serial FROM outputs WHERE id = ?').bind(id).first<{ serial: number }>();
  return c.json({ id, serial: row?.serial ?? 0 }, 201);
});

// Anonymous funnel events. No cookies, no personal data.
publicRoutes.post('/c/:code/events', async (c) => {
  const p = eventsSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'invalid_input' }, 400);
  const r = await findCampaign(c, c.req.param('code'));
  if (!r || c.req.query('preview') === '1') return c.json({ ok: true });
  const now = new Date().toISOString();
  for (const e of p.data.events) {
    await c.env.DB.prepare('INSERT INTO events (campaign_id, visitor_id, type, meta, created_at) VALUES (?,?,?,?,?)')
      .bind(r.id, p.data.visitorId, e.type, e.meta ? JSON.stringify(e.meta) : null, now).run();
  }
  return c.json({ ok: true });
});

// Public settings the browser needs (the Turnstile site key is public by design).
publicRoutes.get('/config', (c) => c.json({ turnstileSiteKey: c.env.TURNSTILE_SITE_KEY ?? null }));

// Home page: campaign cards (live first, then recently ended) and platform totals. ?q= searches title and organiser.
publicRoutes.get('/live', async (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 60);
  const { results } = await c.env.DB.prepare(`${SELECT} WHERE k.status IN ('scheduled', 'ended', 'paused') ORDER BY k.created_at DESC LIMIT 60`).all<Row>();
  let rows = results.filter((r) => ['live', 'ended', 'scheduled'].includes(effectiveState(r)));
  if (q) rows = rows.filter((r) => r.title.toLowerCase().includes(q) || (r.org_name ?? '').toLowerCase().includes(q));
  const order: Record<string, number> = { live: 0, scheduled: 1, ended: 2 };
  rows.sort((a, b) => order[effectiveState(a)] - order[effectiveState(b)]);
  const cards = await cardsFor(c.env.DB, rows.slice(0, 24));
  const tot = await c.env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM outputs) AS frames, (SELECT COUNT(*) FROM campaigns WHERE status != 'draft') AS campaigns, (SELECT COUNT(*) FROM organisations WHERE status = 'active') AS organisations"
  ).first();
  c.header('cache-control', 'public, max-age=30');
  return c.json({ campaigns: cards, live: cards.filter((x) => x.state === 'live'), totals: tot });
});

// Organiser page: their campaigns and total supporters.
publicRoutes.get('/o/:slug', async (c) => {
  const { results: orgs } = await c.env.DB.prepare("SELECT id, name, logo_url, logo_image_id FROM organisations WHERE status = 'active'").all<{ id: string; name: string; logo_url: string | null; logo_image_id: string | null }>();
  const org = orgs.find((o) => slugify(o.name) === c.req.param('slug').toLowerCase());
  if (!org) return c.json({ error: 'not_found' }, 404);
  const { results } = await c.env.DB.prepare(`${SELECT} WHERE k.org_id = ? ORDER BY k.created_at DESC`).bind(org.id).all<Row>();
  const cards = await cardsFor(c.env.DB, results.filter(visible));
  c.header('cache-control', 'public, max-age=30');
  return c.json({
    name: org.name, slug: slugify(org.name), logoUrl: org.logo_image_id ? `/api/images/${org.logo_image_id}` : org.logo_url,
    supporters: cards.reduce((n, x) => n + x.participants, 0), campaigns: cards
  });
});
