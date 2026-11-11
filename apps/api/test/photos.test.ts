import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/index.ts';
import { hashPassword } from '../src/lib/crypto.ts';
import { makeDb } from './d1shim.ts';

const j = JSON.stringify;

/** A unit face signature pointing mostly along axis `k` (so different k = different person). */
function sig(k: number, wobble = 0): Float32Array {
  const v = new Float32Array(128);
  v[k] = 1; v[(k + 1) % 128] = wobble;
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}
const b64 = (...sigs: Float32Array[]) => {
  const all = new Float32Array(sigs.length * 128);
  sigs.forEach((s, i) => all.set(s, i * 128));
  return Buffer.from(all.buffer).toString('base64');
};

async function setup() {
  const { db, sql } = makeDb();
  const hash = await hashPassword('pw-pw-pw-pw-1', 1000);
  sql.exec(`INSERT INTO organisations (id,name,created_at) VALUES ('O1','DCIP','x'),('O2','CGPC','x');
    INSERT INTO users (id,org_id,name,email,role,password_hash,status,must_change_password,created_at) VALUES
      ('M1','O1','Asha','asha@x.in','manager','${hash}','active',0,'x'), ('M2','O2','Ravi','ravi@x.in','manager','${hash}','active',0,'x'), ('V1','O1','View','view@x.in','viewer','${hash}','active',0,'x');
    INSERT INTO campaigns (id,org_id,short_code,title,starts_at,ends_at,status,created_by,created_at,updated_at) VALUES
      ('C1','O1','meet26','Alumni Meet','2020-01-01T00:00:00Z','2099-01-01T00:00:00Z','scheduled','M1','x','x'),
      ('C2','O1','draft1','Draft','2020-01-01T00:00:00Z','2099-01-01T00:00:00Z','draft','M1','x','x');`);
  const env = { DB: db, SESSION_SECRET: 'test-secret-test-secret-test-secret-1234' };
  const req = (path: string, init: RequestInit = {}, cookie?: string) => {
    const headers: Record<string, string> = cookie ? { cookie } : {};
    if (typeof init.body === 'string') headers['content-type'] = 'application/json';
    return app.request(`/api${path}`, { ...init, headers }, env);
  };
  const login = async (email: string) => (await req('/auth/login', { method: 'POST', body: j({ email, password: 'pw-pw-pw-pw-1' }) })).headers.get('set-cookie')!.split(';')[0];
  const add = (cookie: string, name: string, embs: string, camp = 'C1', over: Record<string, File | string> = {}) => {
    const f = new FormData();
    f.set('thumb', new File([new Uint8Array([1, 2, 3])], 't.jpg', { type: 'image/jpeg' }));
    f.set('view', new File([new Uint8Array([4, 5, 6, 7])], 'v.jpg', { type: 'image/jpeg' }));
    f.set('name', name); f.set('width', '1600'); f.set('height', '1067'); f.set('embs', embs);
    for (const [k, v] of Object.entries(over)) f.set(k, v);
    return req(`/admin/campaigns/${camp}/photos`, { method: 'POST', body: f }, cookie);
  };
  return { req, login, add, sql };
}

test('organiser adds photos; a selfie finds the right ones, strongest first; others stay hidden', async () => {
  const { req, login, add } = await setup();
  const m = await login('asha@x.in');
  assert.equal((await add(m, 'group.jpg', b64(sig(1), sig(2), sig(3)))).status, 201);     // persons 1,2,3
  assert.equal((await add(m, 'solo.jpg', b64(sig(1, 0.2)))).status, 201);                  // person 1 again, slightly different
  assert.equal((await add(m, 'other.jpg', b64(sig(7)))).status, 201);                      // person 7
  assert.equal((await add(m, 'scenery.jpg', '')).status, 201);                             // no faces
  assert.equal((await add(m, 'solo.jpg', b64(sig(1)))).status, 409);                       // same file twice is skipped

  const list = (await (await req('/admin/campaigns/C1/photos', {}, m)).json()) as any;
  assert.deepEqual([list.total, list.faces, list.retentionMonths], [4, 5, 31]);
  assert.equal(((await (await req('/c/meet26/photos/info')).json()) as any).photos, 4);

  const match = async (s: Float32Array) => (await (await req('/c/meet26/photos/match', { method: 'POST', body: j({ emb: [...s] }) })).json()) as any;
  const me = await match(sig(1, 0.05));
  assert.deepEqual(me.strong.map((x: any) => x.name), ['group.jpg', 'solo.jpg']);
  assert.ok(me.strong[0].score >= me.strong[1].score && me.strong[1].score > 0.9);
  assert.equal(me.possible.length, 0);
  assert.equal(me.searched, 3);
  assert.deepEqual((await match(sig(50))).strong, []);                                       // a stranger finds nothing
  // an in-between likeness is offered as "possible", not as a sure match
  const half = new Float32Array(128); half[7] = 0.55; half[90] = Math.sqrt(1 - 0.55 * 0.55);
  const maybe = await match(half);
  assert.deepEqual([maybe.strong.length, maybe.possible.map((x: any) => x.name)], [0, ['other.jpg']]);

  // pictures are served by id; the web-size copy can be downloaded with a file name
  const id = me.strong[1].id;
  assert.equal((await (await req(`/photos/${id}/thumb`)).arrayBuffer()).byteLength, 3);
  const dl = await req(`/photos/${id}/view?download=1`);
  assert.equal((await dl.arrayBuffer()).byteLength, 4);
  assert.match(dl.headers.get('content-disposition')!, /solo\.jpg/);
  assert.equal((await req('/photos/nope/view')).status, 404);
});

test('rules: bad input, other organisations, viewers, drafts, deleting', async () => {
  const { req, login, add, sql } = await setup();
  const m = await login('asha@x.in'), other = await login('ravi@x.in'), viewer = await login('view@x.in');
  assert.equal((await add(other, 'a.jpg', '')).status, 404);
  assert.equal((await add(viewer, 'a.jpg', '')).status, 403);
  assert.equal((await add(m, 'a.jpg', Buffer.from(new Uint8Array(100)).toString('base64'))).status, 400); // not whole signatures
  assert.equal((await add(m, 'a.jpg', '', 'C1', { thumb: new File([new Uint8Array(3)], 't.png', { type: 'image/png' }) })).status, 400);
  assert.equal((await add(m, 'a.jpg', '', 'C1', { view: new File([new Uint8Array(1_300_000)], 'v.jpg', { type: 'image/jpeg' }) })).status, 413);
  assert.equal((await req('/c/meet26/photos/match', { method: 'POST', body: j({ emb: [1, 2, 3] }) })).status, 400);
  assert.equal((await req('/c/draft1/photos/info')).status, 404); // unpublished campaigns have no public gallery
  assert.equal((await req('/admin/campaigns/C1/photos')).status, 401);

  const { id } = (await (await add(m, 'a.jpg', b64(sig(4)))).json()) as { id: string };
  await add(m, 'b.jpg', b64(sig(5)));
  assert.equal((await req(`/admin/photos/${id}`, { method: 'DELETE' }, other)).status, 404);
  assert.equal((await req(`/admin/photos/${id}`, { method: 'DELETE' }, m)).status, 200);
  assert.equal((sql.prepare('SELECT COUNT(*) n FROM event_photo_files').get() as any).n, 2);
  assert.equal((await req('/admin/campaigns/C1/photos', { method: 'DELETE' }, m)).status, 200);
  assert.equal((sql.prepare('SELECT COUNT(*) n FROM event_photos').get() as any).n + (sql.prepare('SELECT COUNT(*) n FROM event_photo_files').get() as any).n, 0);
});

test('photos older than 31 months are deleted automatically', async () => {
  const { req, login, add, sql } = await setup();
  const m = await login('asha@x.in');
  await add(m, 'old.jpg', b64(sig(1)));
  await add(m, 'new.jpg', b64(sig(1)));
  const old = new Date(); old.setUTCMonth(old.getUTCMonth() - 32);
  sql.prepare("UPDATE event_photos SET created_at = ? WHERE name = 'old.jpg'").run(old.toISOString());
  const r = (await (await req('/c/meet26/photos/match', { method: 'POST', body: j({ emb: [...sig(1)] }) })).json()) as any;
  assert.deepEqual(r.strong.map((x: any) => x.name), ['new.jpg']);
  assert.equal((sql.prepare('SELECT COUNT(*) n FROM event_photo_files').get() as any).n, 2);
});
