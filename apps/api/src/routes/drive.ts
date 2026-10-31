import { Hono } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import type { AppEnv, UserRow } from '../types.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { audit, writeAudit } from '../lib/audit.ts';
import { encryptSecret } from '../lib/secrets.ts';
import { aboutDrive, accessToken, driveConfigured, forgetToken, SCOPE } from '../lib/drive.ts';

export const drive = new Hono<AppEnv>();

const key = (s: string) => new TextEncoder().encode(s);
const OAUTH_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';

// The Google redirect arrives from another site, so the session cookie (SameSite=Strict) is not sent.
// The signed `state` proves which super admin started the connection.
drive.get('/drive/callback', async (c) => {
  const url = new URL(c.req.url);
  const back = (q: string) => c.redirect(`/admin/drive?${q}`);
  if (url.searchParams.get('error')) return back('error=denied');
  try {
    const { payload } = await jwtVerify(url.searchParams.get('state') ?? '', key(c.env.SESSION_SECRET), { algorithms: ['HS256'] });
    if (payload.purpose !== 'drive' || !payload.sub) return back('error=state');
    const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ? AND role = 'super_admin' AND status = 'active'").bind(payload.sub).first<UserRow>();
    if (!user || !driveConfigured(c.env)) return back('error=state');

    const res = await fetch(`${c.env.GOOGLE_OAUTH_BASE ?? 'https://oauth2.googleapis.com'}/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: url.searchParams.get('code') ?? '', client_id: c.env.GOOGLE_CLIENT_ID!, client_secret: c.env.GOOGLE_CLIENT_SECRET!, redirect_uri: `${url.origin}/api/drive/callback`, grant_type: 'authorization_code' })
    });
    const tok = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string };
    if (!res.ok || !tok.access_token || !tok.refresh_token) return back('error=token');
    const info = await aboutDrive(c.env, tok.access_token);
    await c.env.DB.prepare(
      `INSERT INTO drive_connection (id, email, refresh_token_enc, connected_by, connected_at) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET email = excluded.email, refresh_token_enc = excluded.refresh_token_enc, connected_by = excluded.connected_by, connected_at = excluded.connected_at, root_folder_id = NULL`
    ).bind(info?.email ?? null, await encryptSecret(tok.refresh_token, c.env.TOKEN_ENC_KEY!), user.id, new Date().toISOString()).run();
    // folders belong to the previous Google account, so forget them
    await c.env.DB.prepare('UPDATE organisations SET drive_folder_id = NULL').run();
    await c.env.DB.prepare('UPDATE campaigns SET drive_folder_id = NULL').run();
    forgetToken();
    await writeAudit(c.env.DB, { userId: user.id, action: 'drive.connect', detail: { email: info?.email } });
    return back('connected=1');
  } catch {
    return back('error=state');
  }
});

const admin = new Hono<AppEnv>();
admin.use('*', requireAuth(), requireRole('super_admin'));

admin.get('/status', async (c) => {
  const configured = driveConfigured(c.env);
  const row = await c.env.DB.prepare('SELECT email, connected_at FROM drive_connection WHERE id = 1').first<{ email: string | null; connected_at: string }>();
  let quota: { used: number; limit: number | null } | null = null;
  if (configured && row) {
    const t = await accessToken(c.env);
    const a = t ? await aboutDrive(c.env, t) : null;
    if (a) quota = { used: a.used, limit: a.limit };
  }
  return c.json({ configured, connected: !!row, email: row?.email ?? null, connectedAt: row?.connected_at ?? null, quota });
});

admin.get('/connect', async (c) => {
  if (!driveConfigured(c.env)) return c.json({ error: 'not_configured' }, 409);
  const state = await new SignJWT({ purpose: 'drive' }).setProtectedHeader({ alg: 'HS256' }).setSubject(c.get('user').id).setExpirationTime('10m').sign(key(c.env.SESSION_SECRET));
  const origin = new URL(c.req.url).origin;
  const q = new URLSearchParams({ client_id: c.env.GOOGLE_CLIENT_ID!, redirect_uri: `${origin}/api/drive/callback`, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state });
  return c.redirect(`${OAUTH_AUTH}?${q}`);
});

admin.post('/disconnect', async (c) => {
  await c.env.DB.prepare('DELETE FROM drive_connection WHERE id = 1').run();
  await c.env.DB.prepare('UPDATE organisations SET drive_folder_id = NULL').run();
  await c.env.DB.prepare('UPDATE campaigns SET drive_folder_id = NULL').run();
  forgetToken();
  await audit(c, 'drive.disconnect');
  return c.json({ ok: true });
});

drive.route('/super/drive', admin);
