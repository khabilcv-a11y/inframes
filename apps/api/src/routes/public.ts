import { Hono } from 'hono';
import { eventsSchema, outputSchema } from '@inframe/shared';
import type { AppEnv, UserRow } from '../types.ts';
import { effectiveState } from '../lib/campaign-state.ts';
import { readSession } from '../lib/session.ts';
import { canAccessOrg } from '../middleware/auth.ts';
import { ulid } from '../lib/ids.ts';
import { turnstileOk } from '../lib/turnstile.ts';
import { loadTemplates } from './templates.ts';
import { SELECT, type Row } from './campaigns.ts';

export const publicRoutes = new Hono<AppEnv>();

const MAX_OUTPUTS_PER_VISITOR_PER_HOUR = 20;

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

  const org = await c.env.DB.prepare('SELECT logo_url FROM organisations WHERE id = ?').bind(r.org_id).first<{ logo_url: string | null }>();
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM outputs WHERE campaign_id = ?').bind(r.id).first<{ n: number }>();
  c.header('cache-control', preview ? 'no-store' : 'public, max-age=30');
  return c.json({
    title: r.title, description: r.description, language: r.language, organisation: r.org_name, logoUrl: org?.logo_url ?? null,
    state: preview ? 'live' : effectiveState(r), preview, startsAt: r.starts_at, endsAt: r.ends_at, caption: r.caption,
    hashtags: r.hashtags, thankYou: r.thank_you, ctaUrl: r.cta_url, outputs: n?.n ?? 0,
    templates: await loadTemplates(c.env.DB, r.id)
  });
});

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

  const t = await c.env.DB.prepare('SELECT id FROM templates WHERE id = ? AND campaign_id = ?').bind(p.data.templateId, r.id).first();
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

// Home page: live campaigns and platform totals.
publicRoutes.get('/live', async (c) => {
  const { results } = await c.env.DB.prepare(`${SELECT} WHERE k.status = 'scheduled'`).all<Row>();
  const live = results.filter((r) => effectiveState(r) === 'live');
  const counts = await Promise.all(live.map((r) => c.env.DB.prepare('SELECT COUNT(*) AS n FROM outputs WHERE campaign_id = ?').bind(r.id).first<{ n: number }>()));
  const tot = await c.env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM outputs) AS frames, (SELECT COUNT(*) FROM campaigns WHERE status != 'draft') AS campaigns, (SELECT COUNT(*) FROM organisations WHERE status = 'active') AS organisations"
  ).first();
  c.header('cache-control', 'public, max-age=30');
  return c.json({
    live: live.map((r, i) => ({ title: r.title, organisation: r.org_name, code: r.short_code, participants: counts[i]?.n ?? 0, endsAt: r.ends_at })),
    totals: tot
  });
});
