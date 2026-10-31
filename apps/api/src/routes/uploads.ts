import { Hono } from 'hono';
import { z } from 'zod';
import { uploadRequestSchema } from '@inframe/shared';
import type { AppEnv } from '../types.ts';
import { fileName, scriptUrl, sign } from '../lib/drive.ts';
import { parseWindows } from './templates.ts';

export const uploads = new Hono<AppEnv>();

const WINDOW_MS = 30 * 60_000; // an output can ask for upload slots for 30 minutes after it is made
const RAW_MAX = 15_000_000, FRAMED_MAX = 4_000_000, TRIES = 3;

interface Ctx {
  camp: { id: string; org_id: string; short_code: string; title: string; save_mode: string; org_name: string };
  out: { id: string; serial: number; visitor_id: string; template_id: string; slot_values: string | null; created_at: string; raw_uploads: number; framed_session_at: string | null; raw_drive_ids: string | null; drive_file_id: string | null };
}

async function load(c: { env: AppEnv['Bindings'] }, code: string, outputId: string): Promise<Ctx | null> {
  const camp = await c.env.DB.prepare('SELECT k.id, k.org_id, k.short_code, k.title, k.save_mode, o.name AS org_name FROM campaigns k JOIN organisations o ON o.id = k.org_id WHERE k.short_code = ?').bind(code.toLowerCase()).first<Ctx['camp']>();
  if (!camp) return null;
  const out = await c.env.DB.prepare('SELECT id, serial, visitor_id, template_id, slot_values, created_at, raw_uploads, framed_session_at, raw_drive_ids, drive_file_id FROM outputs WHERE id = ? AND campaign_id = ?').bind(outputId, camp.id).first<Ctx['out']>();
  return out ? { camp, out } : null;
}

const ext = (mime: string) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' } as Record<string, string>)[mime.toLowerCase()] ?? 'jpg';
const rawIds = (s: string | null) => (JSON.parse(s ?? '[]') as string[]);

/**
 * Gives the participant's browser a signed ticket. The browser sends the picture to the owner's Apps Script
 * with that ticket; the script checks the signature, files it in the campaign folder, then tells us (/drive/saved).
 */
uploads.post('/c/:code/outputs/:id/upload', async (c) => {
  const p = uploadRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'invalid_input' }, 400);
  const x = await load(c, c.req.param('code'), c.req.param('id'));
  if (!x || x.out.visitor_id !== p.data.visitorId) return c.json({ error: 'not_found' }, 404);
  const { kind, mime, size } = p.data;
  const mode = x.camp.save_mode;
  if (!(mode === 'both' || mode === kind)) return c.json({ error: 'not_enabled' }, 409);
  if (Date.now() - new Date(x.out.created_at).getTime() > WINDOW_MS) return c.json({ error: 'expired' }, 409);
  const url = await scriptUrl(c.env);
  if (!url) return c.json({ error: 'drive_unavailable' }, 503);

  const tpl = await c.env.DB.prepare('SELECT photo_window FROM templates WHERE id = ?').bind(x.out.template_id).first<{ photo_window: string }>();
  const areas = tpl ? parseWindows(tpl.photo_window).length : 1;
  const saved = rawIds(x.out.raw_drive_ids).length;
  // the framed picture: once saved it is done; if the first attempt has not arrived after 20 s, one more ticket is allowed
  const recentTicket = x.out.framed_session_at && Date.now() - new Date(x.out.framed_session_at).getTime() < 20_000;
  if (kind === 'framed' && (x.out.drive_file_id || recentTicket || size > FRAMED_MAX || mime !== 'image/jpeg')) return c.json({ error: 'not_allowed' }, 409);
  if (kind === 'raw' && (saved >= areas || x.out.raw_uploads >= areas * TRIES || size > RAW_MAX)) return c.json({ error: 'not_allowed' }, 409);

  // file name from what the participant typed, in the order of the frame's boxes, plus the serial
  const { results: slots } = await c.env.DB.prepare('SELECT id FROM text_slots WHERE template_id = ? ORDER BY sort_order').bind(x.out.template_id).all<{ id: string }>();
  const vals = JSON.parse(x.out.slot_values ?? '{}') as Record<string, string>;
  const typed = slots.map((s) => vals[s.id]).filter(Boolean);
  const n = saved + 1;
  const tag = kind === 'raw' ? (mode === 'both' ? (areas > 1 ? ` (original ${n})` : ' (original)') : areas > 1 ? ` (photo ${n})` : '') : mode === 'both' ? ' (framed)' : '';
  const name = fileName(typed, x.out.serial, tag, kind === 'raw' ? ext(mime) : 'jpg');

  const msg = JSON.stringify({ o: x.out.id, k: kind, og: x.camp.org_name.slice(0, 80), cp: `${x.camp.short_code} - ${x.camp.title}`.slice(0, 120), n: name, m: mime, s: size, e: Date.now() + 10 * 60_000, r: crypto.randomUUID() });
  if (kind === 'raw') await c.env.DB.prepare('UPDATE outputs SET raw_uploads = raw_uploads + 1 WHERE id = ?').bind(x.out.id).run();
  else await c.env.DB.prepare('UPDATE outputs SET framed_session_at = ? WHERE id = ?').bind(new Date().toISOString(), x.out.id).run();
  return c.json({ scriptUrl: url, msg, sig: await sign(c.env, msg), name });
});

// The script calls this after it has filed a picture. Only our own signed ticket + the script's signature are accepted.
uploads.post('/drive/saved', async (c) => {
  const p = z.object({ msg: z.string().max(2000), fileId: z.string().min(5).max(200), sig: z.string().length(64) }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'invalid_input' }, 400);
  if (p.data.sig !== (await sign(c.env, `${p.data.msg}|${p.data.fileId}`))) return c.json({ error: 'forbidden' }, 403);
  const m = JSON.parse(p.data.msg) as { o: string; k: 'raw' | 'framed' };
  const out = await c.env.DB.prepare('SELECT id, campaign_id, visitor_id, raw_drive_ids FROM outputs WHERE id = ?').bind(m.o).first<{ id: string; campaign_id: string; visitor_id: string; raw_drive_ids: string | null }>();
  if (!out) return c.json({ error: 'not_found' }, 404);
  if (m.k === 'framed') await c.env.DB.prepare('UPDATE outputs SET drive_file_id = ? WHERE id = ?').bind(p.data.fileId, out.id).run();
  else {
    const ids = rawIds(out.raw_drive_ids);
    if (!ids.includes(p.data.fileId)) await c.env.DB.prepare('UPDATE outputs SET raw_drive_ids = ? WHERE id = ?').bind(JSON.stringify([...ids, p.data.fileId].slice(0, 6)), out.id).run();
  }
  await c.env.DB.prepare('INSERT INTO events (campaign_id, visitor_id, type, meta, created_at) VALUES (?,?,?,?,?)').bind(out.campaign_id, out.visitor_id, 'drive_saved', JSON.stringify({ kind: m.k }), new Date().toISOString()).run();
  return c.json({ ok: true });
});

// The participant's page asks whether its pictures have arrived (the browser cannot read the script's answer directly).
uploads.get('/c/:code/outputs/:id/saved', async (c) => {
  const x = await load(c, c.req.param('code'), c.req.param('id'));
  if (!x || x.out.visitor_id !== c.req.query('visitorId')) return c.json({ error: 'not_found' }, 404);
  return c.json({ raw: rawIds(x.out.raw_drive_ids).length, framed: x.out.drive_file_id ? 1 : 0 });
});
