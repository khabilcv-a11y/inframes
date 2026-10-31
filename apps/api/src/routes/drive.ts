import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { audit } from '../lib/audit.ts';
import { isScriptUrl, pingScript, scriptSource, scriptUrl } from '../lib/drive.ts';

export const drive = new Hono<AppEnv>();
const admin = new Hono<AppEnv>();
admin.use('*', requireAuth(), requireRole('super_admin'));

admin.get('/status', async (c) => {
  const url = await scriptUrl(c.env);
  let row: { email: string | null; connected_at: string } | null = null;
  if (url) row = await c.env.DB.prepare('SELECT email, connected_at FROM drive_script WHERE id = 1').first();
  return c.json({ connected: !!url, email: row?.email ?? null, connectedAt: row?.connected_at ?? null });
});

// The script to paste, with this site's address and secret already filled in.
admin.get('/script', async (c) => c.json({ script: await scriptSource(c.env, new URL(c.req.url).origin) }));

admin.post('/connect', async (c) => {
  const p = z.object({ url: z.string().trim().max(300) }).safeParse(await c.req.json().catch(() => null));
  if (!p.success || !isScriptUrl(p.data.url)) return c.json({ error: 'bad_url' }, 400);
  const ping = await pingScript(c.env, p.data.url);
  if (!ping.ok) return c.json({ error: 'not_reachable' }, 409);
  await c.env.DB.prepare(
    `INSERT INTO drive_script (id, url, email, connected_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET url = excluded.url, email = excluded.email, connected_at = excluded.connected_at`
  ).bind(p.data.url, ping.email ?? null, new Date().toISOString()).run();
  await audit(c, 'drive.connect', undefined, { email: ping.email });
  return c.json({ ok: true, email: ping.email ?? null });
});

admin.post('/test', async (c) => {
  const url = await scriptUrl(c.env);
  if (!url) return c.json({ error: 'not_connected' }, 409);
  const ping = await pingScript(c.env, url);
  return c.json({ ok: ping.ok, email: ping.email ?? null });
});

admin.post('/disconnect', async (c) => {
  await c.env.DB.prepare('DELETE FROM drive_script WHERE id = 1').run();
  await audit(c, 'drive.disconnect');
  return c.json({ ok: true });
});

drive.route('/super/drive', admin);
