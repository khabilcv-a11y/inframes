import type { Env } from '../types.ts';

/**
 * Drive saving works through a small Apps Script that lives in the owner's own Google account.
 * It only accepts requests signed with a secret derived from SESSION_SECRET, so nobody else can use it,
 * and it needs no Google Cloud project, OAuth screen or extra keys.
 */
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function hmac(key: string | ArrayBuffer, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}

/** The shared secret pasted into the script. Derived, so it needs no storage and no extra setting. */
export const scriptSecret = async (e: Env) => (await hmac(e.SESSION_SECRET, 'inframe-drive-script-v1')).slice(0, 40);
export const sign = async (e: Env, msg: string) => hmac(await scriptSecret(e), msg);

export async function scriptUrl(e: Env): Promise<string | null> {
  try {
    return (await e.DB.prepare('SELECT url FROM drive_script WHERE id = 1').first<{ url: string }>())?.url ?? null;
  } catch {
    return null; // migration not applied yet
  }
}

export const isScriptUrl = (u: string) => /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u);

export type PingReason = 'network' | 'access' | 'authorize' | 'code' | 'secret' | 'other';

/** Asks the script who it is. When it fails, says why, so the admin page can point at the exact step. */
export async function pingScript(e: Env, url: string): Promise<{ ok: boolean; email?: string; reason?: PingReason }> {
  const t = String(Date.now());
  let status = 0, text = '';
  try {
    const res = await fetch(`${url}?${new URLSearchParams({ action: 'ping', t, sig: await sign(e, `ping:${t}`) })}`, { redirect: 'follow' });
    status = res.status;
    text = await res.text();
  } catch {
    return { ok: false, reason: 'network' };
  }
  try {
    const j = JSON.parse(text) as { ok?: boolean; email?: string };
    return j.ok === true ? { ok: true, email: j.email } : { ok: false, reason: 'secret' }; // script ran but does not share our secret
  } catch {
    // Google answered with a web page instead of the script's JSON
    if (/accounts\.google\.com|ServiceLogin|Sign in/i.test(text)) return { ok: false, reason: 'access' }; // not set to "Anyone"
    if (/Authorization required|authorize|needs permission/i.test(text)) return { ok: false, reason: 'authorize' };
    if (/function not found|doGet|Script function/i.test(text)) return { ok: false, reason: 'code' };
    return { ok: false, reason: status >= 400 ? 'other' : 'access' };
  }
}

/** A file name from what the participant typed (college, name…) plus the serial, safe for Drive. */
export function fileName(values: string[], serial: number, suffix = '', ext = 'jpg'): string {
  const clean = (s: string) => s.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const base = values.map(clean).filter(Boolean).join(' - ').slice(0, 100) || 'frame';
  return `${base} - ${String(serial).padStart(6, '0')}${suffix}.${ext.replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'jpg'}`;
}

/** The text of the Apps Script, with this site's address and secret filled in. */
export async function scriptSource(e: Env, site: string): Promise<string> {
  return SCRIPT.replace('__SECRET__', await scriptSecret(e)).replace('__SITE__', site);
}

const SCRIPT = `// InFrame: saves participants' pictures into this Google Drive. Paste as-is, then Deploy as a Web app.
const SECRET = '__SECRET__';
const SITE = '__SITE__';

function hmac_(text) {
  return Utilities.computeHmacSha256Signature(text, SECRET)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function folder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Run this once from the editor (choose "authorize" in the toolbar, click Run) to give the script access to your Drive.
function authorize() {
  DriveApp.getRootFolder();
  Logger.log('Authorised for ' + Session.getEffectiveUser().getEmail());
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'ping' && p.sig === hmac_('ping:' + p.t)) {
    return json_({ ok: true, email: Session.getEffectiveUser().getEmail() });
  }
  return json_({ ok: false });
}

function doPost(e) {
  if (!e || !e.postData) return json_({ ok: false, error: 'no data' });
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.sig !== hmac_(body.msg)) return json_({ ok: false, error: 'bad signature' });
    var m = JSON.parse(body.msg);
    if (Date.now() > m.e) return json_({ ok: false, error: 'expired' });

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    var target;
    try {
      target = folder_(folder_(folder_(DriveApp.getRootFolder(), 'InFrame'), m.og), m.cp);
    } finally {
      lock.releaseLock();
    }
    var file = target.createFile(Utilities.newBlob(Utilities.base64Decode(body.data), m.m, m.n));
    UrlFetchApp.fetch(SITE + '/api/drive/saved', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ msg: body.msg, fileId: file.getId(), sig: hmac_(body.msg + '|' + file.getId()) })
    });
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}
`;
