import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/index.ts';
import { hashPassword } from '../src/lib/crypto.ts';
import { forgetToken, fileName } from '../src/lib/drive.ts';
import { decryptSecret, encryptSecret } from '../src/lib/secrets.ts';
import { makeDb } from './d1shim.ts';

const j = JSON.stringify;
const ENV_EXTRA = { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csec', TOKEN_ENC_KEY: 'k'.repeat(32), GOOGLE_OAUTH_BASE: 'https://oauth.test', GOOGLE_API_BASE: 'https://api.test' };

/** A tiny fake of the parts of Google the app talks to. */
function fakeGoogle() {
  const folders = new Map<string, string>(); // name -> id
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url.host}${url.pathname}`);
    const json = (o: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } });
    if (url.host === 'oauth.test' && url.pathname === '/token') {
      const body = new URLSearchParams(String(init?.body));
      return json({ access_token: 'at-1', expires_in: 3600, ...(body.get('grant_type') === 'authorization_code' ? { refresh_token: 'rt-1' } : {}) });
    }
    if (url.host === 'api.test' && url.pathname === '/drive/v3/about') return json({ storageQuota: { usage: '1000', limit: '5000' }, user: { emailAddress: 'owner@gmail.com' } });
    if (url.host === 'api.test' && url.pathname === '/drive/v3/files' && method === 'GET') {
      const m = /name='([^']*)'/.exec(url.searchParams.get('q') ?? '');
      const id = m && folders.get(m[1]);
      return json({ files: id ? [{ id }] : [] });
    }
    if (url.host === 'api.test' && url.pathname === '/drive/v3/files' && method === 'POST') {
      const b = JSON.parse(String(init?.body)); const id = `fld-${folders.size + 1}`; folders.set(b.name, id); return json({ id });
    }
    if (url.host === 'api.test' && url.pathname === '/upload/drive/v3/files') {
      const h = new Headers(init?.headers);
      calls.push(`  origin=${h.get('origin')} name=${JSON.parse(String(init?.body)).name} parent=${JSON.parse(String(init?.body)).parents[0]}`);
      return new Response('{}', { status: 200, headers: { location: 'https://upload.test/session/abc' } });
    }
    if (url.host === 'api.test' && url.pathname.startsWith('/drive/v3/files/')) {
      const id = decodeURIComponent(url.pathname.split('/').pop()!);
      return id === 'good-file' ? json({ id, parents: [[...folders.values()].at(-1)] }) : json({}, 404);
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as typeof fetch;
  return { calls, folders, restore: () => { globalThis.fetch = real; forgetToken(); } };
}

async function setup(saveMode = 'both') {
  const { db, sql } = makeDb();
  const hash = await hashPassword('pw-pw-pw-pw-1', 1000);
  sql.exec(`INSERT INTO organisations (id,name,created_at) VALUES ('O1','DCIP Kozhikode','x');
    INSERT INTO users (id,org_id,name,email,role,password_hash,status,must_change_password,created_at) VALUES ('S1',NULL,'Root','root@x.in','super_admin','${hash}','active',0,'x');
    INSERT INTO campaigns (id,org_id,short_code,title,starts_at,ends_at,status,created_by,created_at,updated_at,save_mode)
      VALUES ('C1','O1','sed26','Special Enrollment Drive','2020-01-01T00:00:00Z','2099-01-01T00:00:00Z','scheduled','S1','x','x','${saveMode}');
    INSERT INTO assets (id,campaign_id,content_type,bytes,data,created_at) VALUES ('A1','C1','image/png',1,x'00','x');
    INSERT INTO templates (id,campaign_id,name,width,height,asset_id,photo_window) VALUES ('T1','C1','F',1080,1080,'A1','[{"x":0,"y":0,"w":10,"h":10}]');
    INSERT INTO text_slots (id,template_id,label,input_type,box,style,sort_order) VALUES ('L1','T1','Your college','text','{}','{}',0), ('L2','T1','Your name','text','{}','{}',1);
    INSERT INTO outputs (id,campaign_id,template_id,serial,visitor_id,media_type,slot_values,created_at) VALUES ('OUT1','C1','T1',1,'visitor-abcdef-1','photo','{"L1":"MES College","L2":"Asha Menon"}','${new Date().toISOString()}');`);
  const env = { DB: db, SESSION_SECRET: 'test-secret-test-secret-test-secret-1234', ...ENV_EXTRA };
  const req = (path: string, init: RequestInit = {}, cookie?: string) =>
    app.request(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...((init.headers as Record<string, string>) ?? {}) }, redirect: 'manual' }, env);
  const cookie = (await req('/auth/login', { method: 'POST', body: j({ email: 'root@x.in', password: 'pw-pw-pw-pw-1' }) })).headers.get('set-cookie')!.split(';')[0];
  const connect = async () => {
    const loc = (await req('/super/drive/connect', {}, cookie)).headers.get('location')!;
    const state = new URL(loc).searchParams.get('state')!;
    return { loc, res: await req(`/drive/callback?code=c1&state=${encodeURIComponent(state)}`) };
  };
  return { req, cookie, sql, connect };
}

test('refresh tokens are encrypted at rest and round-trip', async () => {
  const blob = await encryptSecret('refresh-token-123', 'k'.repeat(32));
  assert.ok(!blob.includes('refresh-token'));
  assert.equal(await decryptSecret(blob, 'k'.repeat(32)), 'refresh-token-123');
  await assert.rejects(decryptSecret(blob, 'x'.repeat(32)));
});

test('file names come from what the participant typed, safe for Drive', () => {
  assert.equal(fileName(['MES College', 'Asha Menon'], 124), 'MES College - Asha Menon - 000124.jpg');
  assert.equal(fileName(['A/B:C*?"<>|', ''], 7, ' (original)', 'png'), 'A B C - 000007 (original).png');
  assert.equal(fileName([], 3), 'frame - 000003.jpg');
  assert.equal(fileName(['മുഹമ്മദ്'], 1), 'മുഹമ്മദ് - 000001.jpg');
});

test('connect Google Drive: only super admin, signed state, token stored encrypted', async () => {
  const g = fakeGoogle();
  try {
    const { req, cookie, sql, connect } = await setup();
    assert.equal((await req('/super/drive/status')).status, 401);
    const before = (await (await req('/super/drive/status', {}, cookie)).json()) as any;
    assert.deepEqual([before.configured, before.connected], [true, false]);

    const { loc, res } = await connect();
    const q = new URL(loc).searchParams;
    assert.equal(q.get('client_id'), 'cid');
    assert.equal(q.get('access_type'), 'offline');
    assert.match(q.get('scope')!, /drive\.file/);
    assert.equal(res.headers.get('location'), '/admin/drive?connected=1');

    const row = sql.prepare('SELECT * FROM drive_connection').get() as any;
    assert.equal(row.email, 'owner@gmail.com');
    assert.ok(!row.refresh_token_enc.includes('rt-1')); // never stored in clear
    const after = (await (await req('/super/drive/status', {}, cookie)).json()) as any;
    assert.deepEqual([after.connected, after.email, after.quota], [true, 'owner@gmail.com', { used: 1000, limit: 5000 }]);

    // a forged or missing state is refused
    assert.equal((await req('/drive/callback?code=x&state=forged')).headers.get('location'), '/admin/drive?error=state');
    assert.equal((await req('/super/drive/disconnect', { method: 'POST' }, cookie)).status, 200);
    assert.equal(((await (await req('/super/drive/status', {}, cookie)).json()) as any).connected, false);
  } finally { g.restore(); }
});

test('participant upload: folders, file names, one-time slots, verification', async () => {
  const g = fakeGoogle();
  try {
    const { req, connect, sql } = await setup('both');
    await connect();
    const v = 'visitor-abcdef-1';
    const ask = (body: object, id = 'OUT1') => req(`/c/sed26/outputs/${id}/upload`, { method: 'POST', headers: { origin: 'https://inframes.pages.dev' }, body: j({ visitorId: v, ...body }) });

    const raw = await ask({ kind: 'raw', mime: 'image/heic', size: 3_000_000 });
    assert.equal(raw.status, 200);
    const r = (await raw.json()) as any;
    assert.equal(r.name, 'MES College - Asha Menon - 000001 (original).heic');
    assert.equal(r.uploadUrl, 'https://upload.test/session/abc');
    // folder path InFrame / DCIP Kozhikode / sed26 - Special Enrollment Drive, and the browser origin is passed to Google
    assert.deepEqual([...g.folders.keys()], ['InFrame', 'DCIP Kozhikode', 'sed26 - Special Enrollment Drive']);
    assert.ok(g.calls.some((c) => c.includes('origin=https://inframes.pages.dev')));

    assert.equal((await ask({ kind: 'raw', mime: 'image/jpeg', size: 1000 })).status, 409); // only one photo area, one original
    const framed = (await (await ask({ kind: 'framed', mime: 'image/jpeg', size: 500_000 })).json()) as any;
    assert.equal(framed.name, 'MES College - Asha Menon - 000001 (framed).jpg');
    assert.equal((await ask({ kind: 'framed', mime: 'image/jpeg', size: 500_000 })).status, 409); // once only

    // limits and ownership
    assert.equal((await ask({ kind: 'raw', mime: 'image/jpeg', size: 30_000_000 })).status, 400);
    assert.equal((await req('/c/sed26/outputs/OUT1/upload', { method: 'POST', body: j({ visitorId: 'someone-else-99', kind: 'raw', mime: 'image/jpeg', size: 10 }) })).status, 404);
    assert.equal((await ask({ kind: 'raw', mime: 'text/html', size: 10 })).status, 400);

    // completion is checked with Google before it is recorded
    const done = (fileId: string, kind = 'raw') => req('/c/sed26/outputs/OUT1/uploaded', { method: 'POST', body: j({ visitorId: v, kind, fileId }) });
    assert.equal((await done('made-up-id')).status, 409);
    assert.equal((await done('good-file')).status, 200);
    assert.equal((await done('good-file', 'framed')).status, 200);
    const out = sql.prepare('SELECT drive_file_id, raw_drive_ids FROM outputs').get() as any;
    assert.equal(out.drive_file_id, 'good-file');
    assert.equal(out.raw_drive_ids, '["good-file"]');
    assert.equal((sql.prepare("SELECT COUNT(*) n FROM events WHERE type='drive_saved'").get() as any).n, 2);
  } finally { g.restore(); }
});

test('modes: off and not-connected save nothing; expired outputs are refused; page only asks consent when real', async () => {
  const g = fakeGoogle();
  try {
    const off = await setup('off');
    await off.connect();
    assert.equal((await off.req('/c/sed26/outputs/OUT1/upload', { method: 'POST', body: j({ visitorId: 'visitor-abcdef-1', kind: 'raw', mime: 'image/jpeg', size: 10 }) })).status, 409);

    const m = await setup('raw');
    assert.equal(((await (await m.req('/c/sed26')).json()) as any).saveMode, 'off'); // Drive not connected yet: no consent line
    await m.connect();
    assert.equal(((await (await m.req('/c/sed26')).json()) as any).saveMode, 'raw');
    m.sql.exec("UPDATE outputs SET created_at = '2020-01-01T00:00:00Z'");
    assert.equal((await m.req('/c/sed26/outputs/OUT1/upload', { method: 'POST', body: j({ visitorId: 'visitor-abcdef-1', kind: 'raw', mime: 'image/jpeg', size: 10 }) })).status, 409);
  } finally { g.restore(); }
});
