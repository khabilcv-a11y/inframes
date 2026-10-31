import { Hono } from 'hono';
import { uploadDoneSchema, uploadRequestSchema } from '@inframe/shared';
import type { AppEnv } from '../types.ts';
import { accessToken, campaignFolder, driveConfigured, fileName, startUpload, verifyFile } from '../lib/drive.ts';
import { parseWindows } from './templates.ts';

export const uploads = new Hono<AppEnv>();

const WINDOW_MS = 30 * 60_000; // an output can request upload slots for 30 minutes after it is made
const RAW_MAX = 25_000_000, FRAMED_MAX = 4_000_000;

interface Ctx {
  camp: { id: string; org_id: string; short_code: string; title: string; save_mode: string; drive_folder_id: string | null; org_name: string };
  out: { id: string; serial: number; visitor_id: string; template_id: string; slot_values: string | null; created_at: string; raw_uploads: number; framed_session_at: string | null; raw_drive_ids: string | null };
}

async function load(c: { env: AppEnv['Bindings'] }, code: string, outputId: string): Promise<Ctx | null> {
  const camp = await c.env.DB.prepare('SELECT k.id, k.org_id, k.short_code, k.title, k.save_mode, k.drive_folder_id, o.name AS org_name FROM campaigns k JOIN organisations o ON o.id = k.org_id WHERE k.short_code = ?').bind(code.toLowerCase()).first<Ctx['camp']>();
  if (!camp) return null;
  const out = await c.env.DB.prepare('SELECT id, serial, visitor_id, template_id, slot_values, created_at, raw_uploads, framed_session_at, raw_drive_ids FROM outputs WHERE id = ? AND campaign_id = ?').bind(outputId, camp.id).first<Ctx['out']>();
  return out ? { camp, out } : null;
}

const ext = (mime: string) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' } as Record<string, string>)[mime.toLowerCase()] ?? 'jpg';

// Gives the participant's browser a one-time Google upload address. The file then goes straight to Drive.
uploads.post('/c/:code/outputs/:id/upload', async (c) => {
  const p = uploadRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'invalid_input' }, 400);
  const x = await load(c, c.req.param('code'), c.req.param('id'));
  if (!x || x.out.visitor_id !== p.data.visitorId) return c.json({ error: 'not_found' }, 404);
  const { kind, mime, size } = p.data;
  const mode = x.camp.save_mode;
  if (!(mode === 'both' || mode === kind)) return c.json({ error: 'not_enabled' }, 409);
  if (Date.now() - new Date(x.out.created_at).getTime() > WINDOW_MS) return c.json({ error: 'expired' }, 409);
  if (!driveConfigured(c.env)) return c.json({ error: 'drive_unavailable' }, 503);
  if (kind === 'framed' && (x.out.framed_session_at || size > FRAMED_MAX || mime !== 'image/jpeg')) return c.json({ error: 'not_allowed' }, 409);
  const tpl = await c.env.DB.prepare('SELECT photo_window FROM templates WHERE id = ?').bind(x.out.template_id).first<{ photo_window: string }>();
  const areas = tpl ? parseWindows(tpl.photo_window).length : 1;
  if (kind === 'raw' && (x.out.raw_uploads >= areas || size > RAW_MAX)) return c.json({ error: 'not_allowed' }, 409);

  const token = await accessToken(c.env);
  if (!token) return c.json({ error: 'drive_unavailable' }, 503);
  try {
    const parent = await campaignFolder(c.env, token, x.camp, x.camp.org_name);
    // file name from what the participant typed, in the order of the frame's boxes, plus the serial
    const { results: slots } = await c.env.DB.prepare('SELECT id FROM text_slots WHERE template_id = ? ORDER BY sort_order').bind(x.out.template_id).all<{ id: string }>();
    const vals = JSON.parse(x.out.slot_values ?? '{}') as Record<string, string>;
    const typed = slots.map((s) => vals[s.id]).filter(Boolean);
    const n = x.out.raw_uploads + 1;
    const tag = kind === 'raw' ? (mode === 'both' ? (areas > 1 ? ` (original ${n})` : ' (original)') : areas > 1 ? ` (photo ${n})` : '') : mode === 'both' ? ' (framed)' : '';
    const name = fileName(typed, x.out.serial, tag, kind === 'raw' ? ext(mime) : 'jpg');
    const origin = c.req.header('origin') ?? new URL(c.req.url).origin;
    const uploadUrl = await startUpload(c.env, token, { name, mime, size, parent, origin });
    if (kind === 'raw') await c.env.DB.prepare('UPDATE outputs SET raw_uploads = raw_uploads + 1 WHERE id = ?').bind(x.out.id).run();
    else await c.env.DB.prepare('UPDATE outputs SET framed_session_at = ? WHERE id = ?').bind(new Date().toISOString(), x.out.id).run();
    return c.json({ uploadUrl, name });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'drive_unavailable' }, 503);
  }
});

// The browser reports the finished upload; we confirm with Google that the file really is in this campaign's folder.
uploads.post('/c/:code/outputs/:id/uploaded', async (c) => {
  const p = uploadDoneSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'invalid_input' }, 400);
  const x = await load(c, c.req.param('code'), c.req.param('id'));
  if (!x || x.out.visitor_id !== p.data.visitorId || !x.camp.drive_folder_id) return c.json({ error: 'not_found' }, 404);
  const token = await accessToken(c.env);
  if (!token || !(await verifyFile(c.env, token, p.data.fileId, x.camp.drive_folder_id))) return c.json({ error: 'not_verified' }, 409);
  if (p.data.kind === 'framed') await c.env.DB.prepare('UPDATE outputs SET drive_file_id = ? WHERE id = ?').bind(p.data.fileId, x.out.id).run();
  else {
    const ids = JSON.parse(x.out.raw_drive_ids ?? '[]') as string[];
    await c.env.DB.prepare('UPDATE outputs SET raw_drive_ids = ? WHERE id = ?').bind(JSON.stringify([...ids, p.data.fileId].slice(0, 6)), x.out.id).run();
  }
  await c.env.DB.prepare('INSERT INTO events (campaign_id, visitor_id, type, meta, created_at) VALUES (?,?,?,?,?)').bind(x.camp.id, p.data.visitorId, 'drive_saved', JSON.stringify({ kind: p.data.kind }), new Date().toISOString()).run();
  return c.json({ ok: true });
});
