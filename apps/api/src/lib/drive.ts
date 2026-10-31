import type { Env } from '../types.ts';
import { decryptSecret } from './secrets.ts';

const OAUTH = (e: Env) => e.GOOGLE_OAUTH_BASE ?? 'https://oauth2.googleapis.com';
const API = (e: Env) => e.GOOGLE_API_BASE ?? 'https://www.googleapis.com';
export const SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';

export const driveConfigured = (e: Env) => !!(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET && e.TOKEN_ENC_KEY);

let cached: { token: string; until: number } | null = null;

/** Short-lived access token from the stored refresh token (cached for most of its hour). */
export async function accessToken(e: Env): Promise<string | null> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const row = await e.DB.prepare('SELECT refresh_token_enc FROM drive_connection WHERE id = 1').first<{ refresh_token_enc: string }>();
  if (!row || !driveConfigured(e)) return null;
  const refresh = await decryptSecret(row.refresh_token_enc, e.TOKEN_ENC_KEY!);
  const res = await fetch(`${OAUTH(e)}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: e.GOOGLE_CLIENT_ID!, client_secret: e.GOOGLE_CLIENT_SECRET!, refresh_token: refresh, grant_type: 'refresh_token' })
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, until: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}
export const forgetToken = () => { cached = null; };

const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const q = (s: string) => s.replaceAll('\\', '\\\\').replaceAll("'", "\\'");

/** Finds a folder this app made (drive.file only sees such files), or creates it. */
export async function ensureFolder(e: Env, token: string, name: string, parent: string | null): Promise<string> {
  const query = `name='${q(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parent ? ` and '${parent}' in parents` : ''}`;
  const found = await fetch(`${API(e)}/drive/v3/files?${new URLSearchParams({ q: query, fields: 'files(id)', pageSize: '1' })}`, { headers: auth(token) });
  if (found.ok) {
    const id = ((await found.json()) as { files?: { id: string }[] }).files?.[0]?.id;
    if (id) return id;
  }
  const made = await fetch(`${API(e)}/drive/v3/files?fields=id`, {
    method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) })
  });
  if (!made.ok) throw new Error(`drive_folder_failed_${made.status}`);
  return ((await made.json()) as { id: string }).id;
}

/** InFrame / <Organisation> / <code - title>. Folder ids are remembered so this is a lookup after the first time. */
export async function campaignFolder(e: Env, token: string, c: { id: string; org_id: string; short_code: string; title: string; drive_folder_id: string | null }, orgName: string): Promise<string> {
  if (c.drive_folder_id) return c.drive_folder_id;
  const conn = await e.DB.prepare('SELECT root_folder_id FROM drive_connection WHERE id = 1').first<{ root_folder_id: string | null }>();
  let root = conn?.root_folder_id ?? null;
  if (!root) { root = await ensureFolder(e, token, 'InFrame', null); await e.DB.prepare('UPDATE drive_connection SET root_folder_id = ? WHERE id = 1').bind(root).run(); }
  const org = await e.DB.prepare('SELECT drive_folder_id FROM organisations WHERE id = ?').bind(c.org_id).first<{ drive_folder_id: string | null }>();
  let orgFolder = org?.drive_folder_id ?? null;
  if (!orgFolder) { orgFolder = await ensureFolder(e, token, orgName, root); await e.DB.prepare('UPDATE organisations SET drive_folder_id = ? WHERE id = ?').bind(orgFolder, c.org_id).run(); }
  const folder = await ensureFolder(e, token, `${c.short_code} - ${c.title}`.slice(0, 120), orgFolder);
  await e.DB.prepare('UPDATE campaigns SET drive_folder_id = ? WHERE id = ?').bind(folder, c.id).run();
  return folder;
}

/** Starts a resumable upload. `origin` lets the browser PUT the file straight to Google. */
export async function startUpload(e: Env, token: string, o: { name: string; mime: string; size: number; parent: string; origin: string }): Promise<string> {
  const res = await fetch(`${API(e)}/upload/drive/v3/files?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: { ...auth(token), 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': o.mime, 'x-upload-content-length': String(o.size), origin: o.origin },
    body: JSON.stringify({ name: o.name, parents: [o.parent] })
  });
  const loc = res.headers.get('location');
  if (!res.ok || !loc) throw new Error(`drive_upload_start_failed_${res.status}`);
  return loc;
}

export async function verifyFile(e: Env, token: string, fileId: string, parent: string): Promise<boolean> {
  const res = await fetch(`${API(e)}/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,parents`, { headers: auth(token) });
  if (!res.ok) return false;
  return ((await res.json()) as { parents?: string[] }).parents?.includes(parent) ?? false;
}

export async function aboutDrive(e: Env, token: string) {
  const res = await fetch(`${API(e)}/drive/v3/about?fields=storageQuota,user`, { headers: auth(token) });
  if (!res.ok) return null;
  const j = (await res.json()) as { storageQuota?: { usage?: string; limit?: string }; user?: { emailAddress?: string } };
  return { used: Number(j.storageQuota?.usage ?? 0), limit: j.storageQuota?.limit ? Number(j.storageQuota.limit) : null, email: j.user?.emailAddress ?? null };
}

/** A file name from what the participant typed (college, name…) plus the serial, safe for Drive. */
export function fileName(values: string[], serial: number, suffix = '', ext = 'jpg'): string {
  const clean = (s: string) => s.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const base = values.map(clean).filter(Boolean).join(' - ').slice(0, 100) || 'frame';
  return `${base} - ${String(serial).padStart(6, '0')}${suffix}.${ext.replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'jpg'}`;
}
