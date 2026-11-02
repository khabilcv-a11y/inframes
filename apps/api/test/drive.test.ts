import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/index.ts';
import { hashPassword } from '../src/lib/crypto.ts';
import { fileName, scriptSecret, scriptSource, sign } from '../src/lib/drive.ts';
import { makeDb } from './d1shim.ts';

const j = JSON.stringify;
const SESSION_SECRET = 'test-secret-test-secret-test-secret-1234';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbTESTscriptID123/exec';

/** Fake of the owner's Apps Script: answers the ping like the real script does (it knows the same secret). */
function fakeScript(opts: { secret: string; email?: string }) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin + url.pathname === SCRIPT_URL) {
      const t = url.searchParams.get('t')!;
      const expected = await sign({ SESSION_SECRET: opts.secret } as never, `ping:${t}`);
      const ok = url.searchParams.get('action') === 'ping' && url.searchParams.get('sig') === expected;
      return new Response(JSON.stringify(ok ? { ok: true, email: opts.email ?? 'owner@gmail.com' } : { ok: false }), { headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
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
  const env = { DB: db, SESSION_SECRET };
  const req = (path: string, init: RequestInit = {}, cookie?: string) =>
    app.request(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...((init.headers as Record<string, string>) ?? {}) } }, env);
  const cookie = (await req('/auth/login', { method: 'POST', body: j({ email: 'root@x.in', password: 'pw-pw-pw-pw-1' }) })).headers.get('set-cookie')!.split(';')[0];
  const connect = (url = SCRIPT_URL) => req('/super/drive/connect', { method: 'POST', body: j({ url }) }, cookie);
  return { req, cookie, sql, connect, env };
}

test('file names come from what the participant typed, safe for Drive', () => {
  assert.equal(fileName(['MES College', 'Asha Menon'], 124), 'MES College - Asha Menon - 000124.jpg');
  assert.equal(fileName(['A/B:C*?"<>|', ''], 7, ' (original)', 'png'), 'A B C - 000007 (original).png');
  assert.equal(fileName([], 3), 'frame - 000003.jpg');
  assert.equal(fileName(['മുഹമ്മദ്'], 1), 'മുഹമ്മദ് - 000001.jpg');
});

test('the script text has this site and the secret filled in, and the secret needs no setting', async () => {
  const env = { SESSION_SECRET } as never;
  const src = await scriptSource(env, 'https://inframes.pages.dev');
  assert.ok(src.includes(await scriptSecret(env)) && src.includes("'https://inframes.pages.dev'"));
  assert.ok(!src.includes('__SECRET__') && !src.includes('__SITE__'));
  assert.equal((await scriptSecret(env)).length, 40);
  assert.notEqual(await scriptSecret(env), await scriptSecret({ SESSION_SECRET: 'another-secret-another-secret-1234' } as never));
});

test('connect: super admin only, link checked, script proves it knows the secret', async () => {
  const { req, cookie, connect, sql } = await setup();
  assert.equal((await req('/super/drive/status')).status, 401);
  assert.deepEqual(await (await req('/super/drive/status', {}, cookie)).json(), { connected: false, email: null, connectedAt: null });
  assert.match(((await (await req('/super/drive/script', {}, cookie)).json()) as any).script, /doPost/);

  assert.equal((await connect('https://evil.example.com/macros/s/x/exec')).status, 400); // not a Google script link
  let restore = fakeScript({ secret: 'a-different-secret-a-different-secret' });
  assert.equal((await connect()).status, 409); // script has the wrong secret (pasted from another site)
  restore();

  // what the page tells the admin when Google answers with something other than the script's JSON
  const real = globalThis.fetch;
  const reply = (body: string, status = 200) => { globalThis.fetch = (async () => new Response(body, { status })) as typeof fetch; };
  const reason = async () => ((await (await connect()).json()) as any).reason;
  reply('<html><a href="https://accounts.google.com/ServiceLogin?x">Sign in</a></html>'); assert.equal(await reason(), 'access');
  reply('<html>Authorization required</html>'); assert.equal(await reason(), 'authorize');
  reply('<html>Script function not found: doGet</html>'); assert.equal(await reason(), 'code');
  globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch; assert.equal(await reason(), 'network');
  globalThis.fetch = real;
  // a failed test can be skipped: browsers reach the script themselves, only this check comes from our server
  reply('<html>nope</html>');
  assert.equal((await req('/super/drive/connect', { method: 'POST', body: j({ url: SCRIPT_URL, skipTest: true }) }, cookie)).status, 200);
  await req('/super/drive/disconnect', { method: 'POST' }, cookie);
  globalThis.fetch = real;

  restore = fakeScript({ secret: SESSION_SECRET });
  const ok = await connect();
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as any).email, 'owner@gmail.com');
  assert.equal((sql.prepare('SELECT url FROM drive_script').get() as any).url, SCRIPT_URL);
  assert.equal(((await (await req('/super/drive/status', {}, cookie)).json()) as any).connected, true);
  assert.equal(((await (await req('/super/drive/test', { method: 'POST' }, cookie)).json()) as any).ok, true);
  restore();
  assert.equal((await req('/super/drive/disconnect', { method: 'POST' }, cookie)).status, 200);
  assert.equal(((await (await req('/super/drive/status', {}, cookie)).json()) as any).connected, false);
});

test('participant ticket, script callback, confirmation', async () => {
  const restore = fakeScript({ secret: SESSION_SECRET });
  try {
    const { req, connect, sql, env } = await setup('both');
    await connect();
    const v = 'visitor-abcdef-1';
    const ask = (body: object, id = 'OUT1') => req(`/c/sed26/outputs/${id}/upload`, { method: 'POST', body: j({ visitorId: v, ...body }) });

    const raw = (await (await ask({ kind: 'raw', mime: 'image/heic', size: 3_000_000 })).json()) as any;
    assert.equal(raw.name, 'MES College - Asha Menon - 000001 (original).heic');
    assert.equal(raw.scriptUrl, SCRIPT_URL);
    const m = JSON.parse(raw.msg);
    assert.deepEqual([m.og, m.cp, m.k], ['DCIP Kozhikode', 'sed26 - Special Enrollment Drive', 'raw']); // InFrame / organisation / campaign folders
    assert.equal(raw.sig, await sign(env as never, raw.msg)); // the script can verify this with the same secret
    assert.ok(m.e > Date.now() && m.e < Date.now() + 11 * 60_000);

    const framed = (await (await ask({ kind: 'framed', mime: 'image/jpeg', size: 500_000 })).json()) as any;
    assert.equal(framed.name, 'MES College - Asha Menon - 000001 (framed).jpg');
    assert.equal((await ask({ kind: 'framed', mime: 'image/jpeg', size: 500_000 })).status, 409); // not twice in a row

    // limits and ownership
    assert.equal((await ask({ kind: 'raw', mime: 'image/jpeg', size: 30_000_000 })).status, 400);
    assert.equal((await req('/c/sed26/outputs/OUT1/upload', { method: 'POST', body: j({ visitorId: 'someone-else-99', kind: 'raw', mime: 'image/jpeg', size: 10 }) })).status, 404);
    assert.equal((await ask({ kind: 'raw', mime: 'text/html', size: 10 })).status, 400);

    // the script reports back: only a correctly signed callback counts
    const saved = (msg: string, fileId: string, sig?: string) => req('/drive/saved', { method: 'POST', body: j({ msg, fileId, sig: sig ?? '' }) });
    const good = async (msg: string, fileId: string) => saved(msg, fileId, await sign(env as never, `${msg}|${fileId}`));
    assert.equal((await saved(raw.msg, 'file-raw-1', 'f'.repeat(64))).status, 403);
    assert.equal((await good(raw.msg, 'file-raw-1')).status, 200);
    assert.equal((await good(raw.msg, 'file-raw-1')).status, 200); // repeated callback is harmless
    assert.equal((await good(framed.msg, 'file-framed-1')).status, 200);
    const out = sql.prepare('SELECT drive_file_id, raw_drive_ids FROM outputs').get() as any;
    assert.equal(out.drive_file_id, 'file-framed-1');
    assert.equal(out.raw_drive_ids, '["file-raw-1"]');
    assert.equal((sql.prepare("SELECT COUNT(*) n FROM events WHERE type='drive_saved'").get() as any).n, 3);
    assert.deepEqual(await (await req(`/c/sed26/outputs/OUT1/saved?visitorId=${v}`)).json(), { raw: 1, framed: 1 });
    assert.equal((await ask({ kind: 'raw', mime: 'image/jpeg', size: 1000 })).status, 409); // its one photo is already saved
  } finally { restore(); }
});

test('modes: off and not-connected save nothing; expired outputs are refused; page only asks consent when real', async () => {
  const restore = fakeScript({ secret: SESSION_SECRET });
  try {
    const off = await setup('off');
    await off.connect();
    assert.equal((await off.req('/c/sed26/outputs/OUT1/upload', { method: 'POST', body: j({ visitorId: 'visitor-abcdef-1', kind: 'raw', mime: 'image/jpeg', size: 10 }) })).status, 409);

    const m = await setup('raw');
    assert.equal(((await (await m.req('/c/sed26')).json()) as any).saveMode, 'off'); // no script connected yet: no consent line
    assert.equal((await m.req('/c/sed26/outputs/OUT1/upload', { method: 'POST', body: j({ visitorId: 'visitor-abcdef-1', kind: 'raw', mime: 'image/jpeg', size: 10 }) })).status, 503);
    await m.connect();
    assert.equal(((await (await m.req('/c/sed26')).json()) as any).saveMode, 'raw');
    m.sql.exec("UPDATE outputs SET created_at = '2020-01-01T00:00:00Z'");
    assert.equal((await m.req('/c/sed26/outputs/OUT1/upload', { method: 'POST', body: j({ visitorId: 'visitor-abcdef-1', kind: 'raw', mime: 'image/jpeg', size: 10 }) })).status, 409);
  } finally { restore(); }
});

test('the real script text runs: accepts our signed ticket, files the picture in InFrame/org/campaign, reports back', async () => {
  const { createHmac } = await import('node:crypto');
  const vm = await import('node:vm');
  const { env, req, connect, sql } = await setup('raw');
  const restore = fakeScript({ secret: SESSION_SECRET });
  try {
    await connect();
    const src = await scriptSource(env as never, 'https://inframes.pages.dev');

    // a small stand-in for Google's Apps Script services
    const tree: any = { name: 'root', kids: new Map(), files: [] };
    const mkFolder = (name: string) => ({
      name, kids: new Map(), files: [] as any[],
      getFoldersByName(n: string) { const f = this.kids.get(n); return { hasNext: () => !!f, next: () => f }; },
      createFolder(n: string) { const f = mkFolder(n); this.kids.set(n, f); return f; },
      createFile(blob: any) { const id = `drive-${this.files.length + 1}`; const f = { blob, getId: () => id }; this.files.push(f); return f; }
    });
    const root: any = mkFolder('root');
    const fetched: any[] = [];
    const ctx: any = {
      Utilities: {
        computeHmacSha256Signature: (t: string, k: string) => [...createHmac('sha256', k).update(t).digest()].map((b) => (b > 127 ? b - 256 : b)),
        base64Decode: (s: string) => [...Buffer.from(s, 'base64')],
        newBlob: (bytes: number[], mime: string, name: string) => ({ bytes, mime, name })
      },
      ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s: string) => ({ content: s, setMimeType() { return this; } }) },
      LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
      DriveApp: { getRootFolder: () => root },
      UrlFetchApp: { fetch: (url: string, o: any) => { fetched.push({ url, ...o }); } },
      Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@gmail.com' }) },
      Logger: { log() {} },
      Date, JSON, String
    };
    vm.createContext(ctx);
    vm.runInContext(src, ctx);

    // running the functions by hand from the editor (no web request attached) must not throw
    assert.equal(JSON.parse(ctx.doGet().content).ok, false);
    assert.equal(JSON.parse(ctx.doPost().content).ok, false);
    assert.equal(typeof ctx.authorize, 'function');

    // ping with our signature
    const t = '12345';
    const pingSig = await sign(env as never, `ping:${t}`);
    assert.equal(JSON.parse(ctx.doGet({ parameter: { action: 'ping', t, sig: pingSig } }).content).ok, true);
    assert.equal(JSON.parse(ctx.doGet({ parameter: { action: 'ping', t, sig: 'bad' } }).content).ok, false);

    // a real ticket from the server, posted the way the browser does it
    const ticket = (await (await req('/c/sed26/outputs/OUT1/upload', { method: 'POST', body: j({ visitorId: 'visitor-abcdef-1', kind: 'raw', mime: 'image/jpeg', size: 5 }) })).json()) as any;
    const post = (o: object) => JSON.parse(ctx.doPost({ postData: { contents: j(o) } }).content);
    assert.equal(post({ msg: ticket.msg, sig: 'f'.repeat(64), data: 'aGVsbG8=' }).ok, false); // forged

    const res = post({ msg: ticket.msg, sig: ticket.sig, data: Buffer.from('hello').toString('base64') });
    assert.equal(res.ok, true);
    const campaign = root.kids.get('InFrame').kids.get('DCIP Kozhikode').kids.get('sed26 - Special Enrollment Drive');
    assert.equal(campaign.files[0].blob.name, 'MES College - Asha Menon - 000001.jpg');
    assert.equal(Buffer.from(campaign.files[0].blob.bytes).toString(), 'hello');
    post({ msg: ticket.msg, sig: ticket.sig, data: 'aGVsbG8=' }); // a second upload reuses the same folders
    assert.equal(root.kids.get('InFrame').kids.get('DCIP Kozhikode').kids.size, 1);

    // the script's callback is accepted by the server
    const cb = JSON.parse(fetched[0].payload);
    assert.equal(fetched[0].url, 'https://inframes.pages.dev/api/drive/saved');
    assert.equal((await req('/drive/saved', { method: 'POST', body: j(cb) })).status, 200);
    assert.equal((sql.prepare('SELECT raw_drive_ids FROM outputs').get() as any).raw_drive_ids, '["drive-1"]');

    // an expired ticket is refused by the script itself
    const old = JSON.stringify({ ...JSON.parse(ticket.msg), e: Date.now() - 1000 });
    assert.equal(post({ msg: old, sig: await sign(env as never, old), data: 'aGVsbG8=' }).error, 'expired');
  } finally { restore(); }
});
