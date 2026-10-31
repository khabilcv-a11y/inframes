import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { canAccessOrg, requireAuth, requireRole } from '../middleware/auth.ts';
import { effectiveState } from '../lib/campaign-state.ts';
import { SELECT, type Row } from './campaigns.ts';

export const insights = new Hono<AppEnv>();
insights.use('*', requireAuth());

const IST_MS = 330 * 60_000;
const istDay = (iso: string) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);

async function accessible(c: { env: AppEnv['Bindings']; get: (k: 'user') => AppEnv['Variables']['user'] }, id: string) {
  const r = await c.env.DB.prepare(`${SELECT} WHERE k.id = ?`).bind(id).first<Row>();
  return r && canAccessOrg(c.get('user'), r.org_id) ? r : null;
}

// Dashboard counters, scoped to the admin's organisation (all organisations for the super admin).
insights.get('/admin/overview', async (c) => {
  const u = c.get('user');
  const scoped = u.role !== 'super_admin';
  const bind = scoped ? [u.org_id] : [];
  const where = scoped ? 'WHERE k.org_id = ?' : '';
  const { results } = await c.env.DB.prepare(`${SELECT} ${where}`).bind(...bind).all<Row>();
  const states = results.map((r) => effectiveState(r));
  const outs = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN o.created_at >= ? THEN 1 ELSE 0 END) AS today
     FROM outputs o JOIN campaigns k ON k.id = o.campaign_id ${where}`
  ).bind(new Date(Date.now() - 24 * 3600_000).toISOString(), ...bind).first<{ total: number; today: number | null }>();
  const admins = scoped ? null : await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role != 'super_admin' AND status = 'active'").first<{ n: number }>();
  const orgs = scoped ? null : await c.env.DB.prepare("SELECT COUNT(*) AS n FROM organisations WHERE status = 'active'").first<{ n: number }>();
  return c.json({
    campaigns: results.length, live: states.filter((s) => s === 'live').length, upcoming: states.filter((s) => s === 'scheduled').length,
    drafts: states.filter((s) => s === 'draft').length, framesTotal: outs?.total ?? 0, frames24h: outs?.today ?? 0,
    activeAdmins: admins?.n ?? null, organisations: orgs?.n ?? null,
    recent: results.slice(0, 5).map((r) => ({ id: r.id, title: r.title, state: effectiveState(r), shortCode: r.short_code }))
  });
});

insights.get('/admin/campaigns/:id/metrics', async (c) => {
  const r = await accessible(c, c.req.param('id'));
  if (!r) return c.json({ error: 'not_found' }, 404);
  const { results: ev } = await c.env.DB.prepare('SELECT type, COUNT(DISTINCT visitor_id) AS people, COUNT(*) AS n FROM events WHERE campaign_id = ? GROUP BY type').bind(r.id).all<{ type: string; people: number; n: number }>();
  const { results: outs } = await c.env.DB.prepare('SELECT o.created_at, o.slot_values, t.name AS template FROM outputs o JOIN templates t ON t.id = o.template_id WHERE o.campaign_id = ?').bind(r.id).all<{ created_at: string; slot_values: string | null; template: string }>();
  const { results: dd } = await c.env.DB.prepare(
    "SELECT s.id, s.label FROM text_slots s JOIN templates t ON t.id = s.template_id WHERE t.campaign_id = ? AND s.input_type = 'dropdown' ORDER BY s.sort_order"
  ).bind(r.id).all<{ id: string; label: string }>();

  const byDay: Record<string, number> = {};
  const byTemplate: Record<string, number> = {};
  const byValue: Record<string, number> = {};
  const ddIds = new Set(dd.map((d) => d.id));
  for (const o of outs) {
    byDay[istDay(o.created_at)] = (byDay[istDay(o.created_at)] ?? 0) + 1;
    byTemplate[o.template] = (byTemplate[o.template] ?? 0) + 1;
    for (const [k, v] of Object.entries(JSON.parse(o.slot_values ?? '{}') as Record<string, string>)) {
      if (ddIds.has(k) && v) byValue[v] = (byValue[v] ?? 0) + 1;
    }
  }
  const people = (t: string) => ev.find((e) => e.type === t)?.people ?? 0;
  const rank = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  return c.json({
    funnel: { visits: people('visit'), picked: people('pick'), created: outs.length, shared: people('share'), downloaded: people('download') },
    perDay: Object.entries(byDay).sort().map(([day, count]) => ({ day, count })),
    byTemplate: rank(byTemplate), byDropdown: { label: dd[0]?.label ?? null, rows: rank(byValue) },
    errors: ev.find((e) => e.type === 'error')?.n ?? 0
  });
});

const csvCell = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
insights.get('/admin/campaigns/:id/export.csv', async (c) => {
  const r = await accessible(c, c.req.param('id'));
  if (!r) return c.json({ error: 'not_found' }, 404);
  const { results: slots } = await c.env.DB.prepare('SELECT s.id, s.label FROM text_slots s JOIN templates t ON t.id = s.template_id WHERE t.campaign_id = ? ORDER BY t.sort_order, s.sort_order').bind(r.id).all<{ id: string; label: string }>();
  const { results } = await c.env.DB.prepare('SELECT o.serial, o.created_at, o.slot_values, t.name AS template FROM outputs o JOIN templates t ON t.id = o.template_id WHERE o.campaign_id = ? ORDER BY o.serial').bind(r.id).all<{ serial: number; created_at: string; slot_values: string | null; template: string }>();
  const labels = [...new Set(slots.map((s) => s.label))];
  const byLabel = new Map(slots.map((s) => [s.id, s.label]));
  const lines = [['Serial', 'Created (UTC)', 'Template', ...labels].map(csvCell).join(',')];
  for (const o of results) {
    const vals: Record<string, string> = {};
    for (const [k, v] of Object.entries(JSON.parse(o.slot_values ?? '{}') as Record<string, string>)) vals[byLabel.get(k) ?? k] = v;
    lines.push([o.serial, o.created_at, o.template, ...labels.map((l) => vals[l] ?? '')].map(csvCell).join(','));
  }
  return new Response('﻿' + lines.join('\n'), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${r.short_code}-outputs.csv"` }
  });
});

insights.get('/super/audit', requireRole('super_admin'), async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
  const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.action, a.target_type AS targetType, a.target_id AS targetId, a.detail, a.created_at AS createdAt, u.name AS userName, u.email
     FROM audit_log a JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();
  return c.json({ entries: results });
});
