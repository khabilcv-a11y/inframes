import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/index.ts';
import { hashPassword } from '../src/lib/crypto.ts';
import { makeDb } from './d1shim.ts';

const j = JSON.stringify;
async function setup() {
  const { db, sql } = makeDb();
  const hash = await hashPassword('pw-pw-pw-pw-1', 1000);
  sql.exec("INSERT INTO organisations (id,name,created_at) VALUES ('O1','DCIP','x'),('O2','CGPC','x')");
  const u = sql.prepare("INSERT INTO users (id,org_id,name,email,role,password_hash,status,must_change_password,created_at) VALUES (?,?,?,?,?,?,'active',0,'x')");
  u.run('M1', 'O1', 'Asha', 'asha@x.in', 'manager', hash);
  u.run('M2', 'O2', 'Ravi', 'ravi@x.in', 'manager', hash);
  const env = { DB: db, SESSION_SECRET: 'test-secret-test-secret-test-secret-1234' };
  const req = (path: string, init: RequestInit = {}, cookie?: string) => {
    const headers: Record<string, string> = cookie ? { cookie } : {};
    if (typeof init.body === 'string') headers['content-type'] = 'application/json';
    return app.request(`/api${path}`, { ...init, headers }, env);
  };
  const login = async (email: string) =>
    (await req('/auth/login', { method: 'POST', body: j({ email, password: 'pw-pw-pw-pw-1' }) })).headers.get('set-cookie')!.split(';')[0];
  const m1 = await login('asha@x.in');
  const camp = (await (await req('/admin/campaigns', { method: 'POST', body: j({ title: 'SED', startsAt: new Date(Date.now() - 3600_000).toISOString(), endsAt: new Date(Date.now() + 86400_000).toISOString(), shortCode: 'sed26' }) }, m1)).json()) as { id: string };
  return { req, login, m1, campId: camp.id, sql };
}

const png = () => new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])], 'f.png', { type: 'image/png' });
function upload(req: Awaited<ReturnType<typeof setup>>['req'], campId: string, cookie: string, over: Record<string, string> = {}, file: File = png()) {
  const f = new FormData();
  f.set('file', file); f.set('name', 'Frame A'); f.set('width', '1080'); f.set('height', '1080');
  f.set('photoWindow', j({ x: 90, y: 90, w: 900, h: 700 }));
  for (const [k, v] of Object.entries(over)) f.set(k, v);
  return req(`/admin/campaigns/${campId}/templates`, { method: 'POST', body: f }, cookie);
}
const slots = [
  { label: 'Your name', inputType: 'text', required: true, box: { x: 90, y: 820, w: 900, h: 90 }, style: { font: 'Inter', maxSize: 64, minSize: 24, lines: 1, color: '#FFFFFF', weight: 700, tracking: 0, align: 'center', valign: 'middle', case: 'title' }, maxChars: 40 },
  { label: 'Your college', inputType: 'dropdown', options: ['MES College', 'Devagiri College'], required: true, box: { x: 90, y: 920, w: 900, h: 80 }, style: { font: 'Inter', maxSize: 44, minSize: 20, lines: 1, color: '#FFFFFF', weight: 500, tracking: 0, align: 'center', valign: 'middle', case: 'as_typed' }, maxChars: 60 }
];

test('upload frame, save boxes, serve asset and public page with templates', async () => {
  const { req, m1, campId } = await setup();
  const up = await upload(req, campId, m1);
  assert.equal(up.status, 201);
  const { id: tid } = (await up.json()) as { id: string };
  assert.equal((await req(`/admin/templates/${tid}/slots`, { method: 'PUT', body: j({ slots }) }, m1)).status, 200);

  const list = (await (await req(`/admin/campaigns/${campId}/templates`, {}, m1)).json()) as any;
  assert.equal(list.templates[0].slots.length, 2);
  const asset = await req(list.templates[0].assetUrl.replace('/api', ''));
  assert.equal(asset.headers.get('content-type'), 'image/png');
  assert.equal((await asset.arrayBuffer()).byteLength, 8);

  // draft is hidden publicly; visible to its org admin in preview mode only
  assert.equal((await req('/c/sed26')).status, 404);
});

test('rejects bad files, sizes and boxes', async () => {
  const { req, m1, campId } = await setup();
  assert.equal((await upload(req, campId, m1, {}, new File([new Uint8Array(4)], 'a.jpg', { type: 'image/jpeg' }))).status, 400);
  assert.equal((await upload(req, campId, m1, {}, new File([new Uint8Array(1_600_000)], 'a.png', { type: 'image/png' }))).status, 413);
  assert.equal((await upload(req, campId, m1, { width: '1000', height: '1000' })).status, 400);
  assert.equal((await upload(req, campId, m1, { width: '1080', height: '1350' })).status, 201); // 4:5 portrait is a standard size
  assert.equal((await upload(req, campId, m1, { photoWindow: j({ x: 500, y: 0, w: 900, h: 100 }) })).status, 400);
  const { id } = (await (await upload(req, campId, m1)).json()) as { id: string };
  const bad = [{ ...slots[0], box: { x: 1000, y: 0, w: 200, h: 50 } }];
  assert.equal((await req(`/admin/templates/${id}/slots`, { method: 'PUT', body: j({ slots: bad }) }, m1)).status, 400);
  const noOpts = [{ ...slots[1], options: [] }];
  assert.equal((await req(`/admin/templates/${id}/slots`, { method: 'PUT', body: j({ slots: noOpts }) }, m1)).status, 400);
});

test('other organisations cannot touch templates', async () => {
  const { req, login, m1, campId } = await setup();
  const { id } = (await (await upload(req, campId, m1)).json()) as { id: string };
  const m2 = await login('ravi@x.in');
  assert.equal((await upload(req, campId, m2)).status, 404);
  assert.equal((await req(`/admin/templates/${id}`, { method: 'DELETE' }, m2)).status, 404);
  assert.equal((await req(`/admin/templates/${id}/slots`, { method: 'PUT', body: j({ slots }) }, m2)).status, 404);
});

test('participant flow: live page, register frame, events, metrics, csv, rate limit', async () => {
  const { req, m1, campId } = await setup();
  const { id: tid } = (await (await upload(req, campId, m1)).json()) as { id: string };
  await req(`/admin/templates/${tid}/slots`, { method: 'PUT', body: j({ slots }) }, m1);
  assert.equal((await req('/c/sed26')).status, 404); // still draft
  const prev = (await (await req('/c/sed26?preview=1', {}, m1)).json()) as any;
  assert.equal(prev.preview, true);
  assert.equal(prev.templates[0].slots[1].options.length, 2);
  assert.equal((await req('/c/sed26?preview=1')).status, 404); // anonymous cannot preview

  assert.equal((await req(`/admin/campaigns/${campId}/state`, { method: 'POST', body: j({ action: 'publish' }) }, m1)).status, 200);
  const pub = (await (await req('/c/sed26')).json()) as any;
  assert.equal(pub.state, 'live');
  const slotIds = pub.templates[0].slots.map((s: any) => s.id);

  const visitor = 'visitor-abcdef-1';
  await req('/c/sed26/events', { method: 'POST', body: j({ visitorId: visitor, events: [{ type: 'visit' }, { type: 'pick' }] }) });
  const o1 = await req('/c/sed26/outputs', { method: 'POST', body: j({ templateId: tid, visitorId: visitor, slotValues: { [slotIds[0]]: 'Asha Menon', [slotIds[1]]: 'MES College' } }) });
  assert.equal(o1.status, 201);
  assert.equal(((await o1.json()) as any).serial, 1);
  const o2 = await req('/c/sed26/outputs', { method: 'POST', body: j({ templateId: tid, visitorId: 'visitor-other-22', slotValues: { [slotIds[1]]: 'MES College' } }) });
  assert.equal(((await o2.json()) as any).serial, 2);
  await req('/c/sed26/events', { method: 'POST', body: j({ visitorId: visitor, events: [{ type: 'share' }] }) });

  const m = (await (await req(`/admin/campaigns/${campId}/metrics`, {}, m1)).json()) as any;
  assert.deepEqual(m.funnel, { visits: 1, picked: 1, created: 2, shared: 1, downloaded: 0 });
  assert.deepEqual(m.byDropdown.rows, [{ name: 'MES College', count: 2 }]);
  assert.equal(m.byDropdown.label, 'Your college');

  const csv = await (await req(`/admin/campaigns/${campId}/export.csv`, {}, m1)).text();
  assert.match(csv, /"Your name","Your college"/);
  assert.match(csv, /"Asha Menon","MES College"/);

  const live = (await (await req('/live')).json()) as any;
  assert.equal(live.live[0].participants, 2);
  assert.match(live.live[0].coverUrl, /^\/api\/assets\//); // card thumbnail comes from the first frame
  assert.equal(live.live[0].orgSlug, 'dcip');
  assert.equal(((await (await req('/live?q=nothing-here')).json()) as any).campaigns.length, 0);
  const org = (await (await req('/o/dcip')).json()) as any;
  assert.equal(org.name, 'DCIP');
  assert.equal(org.supporters, 2);
  assert.equal((await req('/o/unknown')).status, 404);
  assert.equal(live.totals.frames, 2);

  const ov = (await (await req('/admin/overview', {}, m1)).json()) as any;
  assert.equal(ov.live, 1);
  assert.equal(ov.framesTotal, 2);

  for (let i = 0; i < 20; i++) await req('/c/sed26/outputs', { method: 'POST', body: j({ templateId: tid, visitorId: visitor, slotValues: {} }) });
  assert.equal((await req('/c/sed26/outputs', { method: 'POST', body: j({ templateId: tid, visitorId: visitor, slotValues: {} }) })).status, 429);
  assert.equal((await req(`/admin/templates/${tid}`, { method: 'DELETE' }, m1)).status, 409); // has outputs
});

test('bot check is dormant without a secret and enforced with one', async () => {
  const { db, sql } = makeDb();
  sql.exec(`INSERT INTO organisations (id,name,created_at) VALUES ('O1','DCIP','x');
    INSERT INTO users (id,org_id,name,email,role,status,created_at) VALUES ('U1','O1','A','a@x.in','manager','active','x');
    INSERT INTO campaigns (id,org_id,short_code,title,starts_at,ends_at,status,created_by,created_at,updated_at)
      VALUES ('C1','O1','bot26','T','2020-01-01T00:00:00Z','2099-01-01T00:00:00Z','scheduled','U1','x','x');
    INSERT INTO assets (id,campaign_id,content_type,bytes,data,created_at) VALUES ('A1','C1','image/png',1,x'00','x');
    INSERT INTO templates (id,campaign_id,name,width,height,asset_id,photo_window) VALUES ('T1','C1','F',1080,1080,'A1','{"x":0,"y":0,"w":10,"h":10}');`);
  const post = (env: Record<string, unknown>, token?: string) =>
    app.request('/api/c/bot26/outputs', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: j({ templateId: 'T1', visitorId: 'visitor-abcdef-1', slotValues: {}, turnstileToken: token }) }, { DB: db, SESSION_SECRET: 'x'.repeat(40), ...env });
  assert.equal((await post({})).status, 201); // no secret configured: dormant
  assert.equal((await post({ TURNSTILE_SECRET: 's' })).status, 400); // secret set, no token
  const cfg = await app.request('/api/config', {}, { DB: db, SESSION_SECRET: 'x'.repeat(40), TURNSTILE_SITE_KEY: 'pub-key' });
  assert.equal(((await cfg.json()) as any).turnstileSiteKey, 'pub-key');
});

test('logos: upload, serve, fall back from campaign to organisation, reject bad files, isolate organisations', async () => {
  const { req, login, m1, campId } = await setup();
  const form = (f: File) => { const d = new FormData(); d.set('file', f); return d; };
  const logo = new File([new Uint8Array([1, 2, 3])], 'l.png', { type: 'image/png' });

  const org = await req('/admin/organisations/O1/logo', { method: 'POST', body: form(logo) }, m1);
  assert.equal(org.status, 200);
  const { url } = (await org.json()) as { url: string };
  const img = await req(url.replace('/api', ''));
  assert.equal(img.headers.get('content-type'), 'image/png');

  // campaign has no logo of its own: it shows the organisation's; its own logo wins once uploaded
  const c1 = (await (await req(`/admin/campaigns/${campId}`, {}, m1)).json()) as any;
  assert.equal(c1.campaign.logoUrl, url);
  assert.equal(c1.campaign.ownLogo, false);
  const own = (await (await req(`/admin/campaigns/${campId}/logo`, { method: 'POST', body: form(logo) }, m1)).json()) as { url: string };
  const c2 = (await (await req(`/admin/campaigns/${campId}`, {}, m1)).json()) as any;
  assert.equal(c2.campaign.logoUrl, own.url);
  assert.equal((await req(`/admin/campaigns/${campId}/logo`, { method: 'DELETE' }, m1)).status, 200);
  assert.equal((((await (await req(`/admin/campaigns/${campId}`, {}, m1)).json()) as any).campaign.logoUrl), url);

  assert.equal((await req('/admin/organisations/O1/logo', { method: 'POST', body: form(new File([new Uint8Array(3)], 'x.gif', { type: 'image/gif' })) }, m1)).status, 400);
  assert.equal((await req('/admin/organisations/O1/logo', { method: 'POST', body: form(new File([new Uint8Array(400_000)], 'x.png', { type: 'image/png' })) }, m1)).status, 413);
  const m2 = await login('ravi@x.in');
  assert.equal((await req('/admin/organisations/O1/logo', { method: 'POST', body: form(logo) }, m2)).status, 404);
  assert.equal((await req(`/admin/campaigns/${campId}/logo`, { method: 'POST', body: form(logo) }, m2)).status, 404);
});
