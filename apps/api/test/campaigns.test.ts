import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/index.ts';
import { hashPassword } from '../src/lib/crypto.ts';
import { effectiveState } from '../src/lib/campaign-state.ts';
import { makeDb } from './d1shim.ts';

const j = JSON.stringify;
async function setup() {
  const { db, sql } = makeDb();
  const hash = await hashPassword('pw-pw-pw-pw-1', 1000);
  sql.exec("INSERT INTO organisations (id,name,created_at) VALUES ('O1','DCIP','x'),('O2','CGPC','x')");
  const u = sql.prepare("INSERT INTO users (id,org_id,name,email,role,password_hash,status,must_change_password,created_at) VALUES (?,?,?,?,?,?,'active',0,'x')");
  u.run('S1', null, 'Root', 'root@x.in', 'super_admin', hash);
  u.run('M1', 'O1', 'Asha', 'asha@x.in', 'manager', hash);
  u.run('M2', 'O2', 'Ravi', 'ravi@x.in', 'manager', hash);
  u.run('V1', 'O1', 'View', 'view@x.in', 'viewer', hash);
  const env = { DB: db, SESSION_SECRET: 'test-secret-test-secret-test-secret-1234' };
  const req = (path: string, init: RequestInit = {}, cookie?: string) =>
    app.request(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } }, env);
  const login = async (email: string) =>
    (await req('/auth/login', { method: 'POST', body: j({ email, password: 'pw-pw-pw-pw-1' }) })).headers.get('set-cookie')!.split(';')[0];
  return { req, login };
}
const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const body = (o = {}) => j({ title: 'Voter Day', startsAt: future(1), endsAt: future(5), ...o });

test('effectiveState follows the clock and the daily window', () => {
  const c = { status: 'scheduled', starts_at: '2026-11-02T00:00:00Z', ends_at: '2026-11-03T00:00:00Z', daily_window: null };
  assert.equal(effectiveState(c, new Date('2026-11-01T12:00:00Z')), 'scheduled');
  assert.equal(effectiveState(c, new Date('2026-11-02T12:00:00Z')), 'live');
  assert.equal(effectiveState(c, new Date('2026-11-03T00:00:00Z')), 'ended');
  assert.equal(effectiveState({ ...c, status: 'paused' }, new Date('2026-11-02T12:00:00Z')), 'paused');
  const w = { ...c, daily_window: j({ from: '09:00', to: '18:00' }) }; // IST
  assert.equal(effectiveState(w, new Date('2026-11-02T05:00:00Z')), 'live'); // 10:30 IST
  assert.equal(effectiveState(w, new Date('2026-11-02T14:00:00Z')), 'scheduled'); // 19:30 IST
});

test('manager creates, publishes, pauses; public page hides drafts', async () => {
  const { req, login } = await setup();
  const m = await login('asha@x.in');
  const created = await req('/admin/campaigns', { method: 'POST', body: body() }, m);
  assert.equal(created.status, 201);
  const { id, shortCode } = (await created.json()) as { id: string; shortCode: string };
  assert.match(shortCode, /^[a-z0-9]{6}$/);

  assert.equal((await req(`/c/${shortCode}`)).status, 404); // draft
  assert.equal((await req(`/admin/campaigns/${id}/state`, { method: 'POST', body: j({ action: 'pause' }) }, m)).status, 409);
  assert.equal((await req(`/admin/campaigns/${id}/state`, { method: 'POST', body: j({ action: 'publish' }) }, m)).status, 200);

  const pub = (await (await req(`/c/${shortCode}`)).json()) as any;
  assert.equal(pub.state, 'scheduled');
  assert.equal(pub.organisation, 'DCIP');
  assert.equal((await req(`/admin/campaigns/${id}/state`, { method: 'POST', body: j({ action: 'pause' }) }, m)).status, 200);
  assert.equal(((await (await req(`/c/${shortCode}`)).json()) as any).state, 'paused');
});

test('organisations are isolated; viewers are read-only; bad dates rejected', async () => {
  const { req, login } = await setup();
  const m1 = await login('asha@x.in'), m2 = await login('ravi@x.in'), v = await login('view@x.in'), s = await login('root@x.in');
  const { id } = (await (await req('/admin/campaigns', { method: 'POST', body: body() }, m1)).json()) as { id: string };

  assert.equal((await req(`/admin/campaigns/${id}`, {}, m2)).status, 404);
  assert.equal(((await (await req('/admin/campaigns', {}, m2)).json()) as any).campaigns.length, 0);
  assert.equal(((await (await req('/admin/campaigns', {}, v)).json()) as any).campaigns.length, 1);
  assert.equal((await req('/admin/campaigns', { method: 'POST', body: body() }, v)).status, 403);
  assert.equal((await req('/admin/campaigns', { method: 'POST', body: body({ endsAt: future(0) }) }, m1)).status, 400);

  assert.equal((await req('/admin/campaigns', { method: 'POST', body: body({ orgId: 'O2' }) }, s)).status, 201);
  assert.equal((await req('/admin/campaigns', { method: 'POST', body: body() }, s)).status, 400); // super admin must pick an org
});

test('custom short code must be unique; edits are saved', async () => {
  const { req, login } = await setup();
  const m = await login('asha@x.in');
  assert.equal((await req('/admin/campaigns', { method: 'POST', body: body({ shortCode: 'kz26vd' }) }, m)).status, 201);
  assert.equal((await req('/admin/campaigns', { method: 'POST', body: body({ shortCode: 'kz26vd' }) }, m)).status, 409);
  const { id } = (await (await req('/admin/campaigns', { method: 'POST', body: body() }, m)).json()) as { id: string };
  assert.equal((await req(`/admin/campaigns/${id}`, { method: 'PATCH', body: j({ title: 'New title', caption: 'Join us' }) }, m)).status, 200);
  const c = (await (await req(`/admin/campaigns/${id}`, {}, m)).json()) as any;
  assert.equal(c.campaign.title, 'New title');
  assert.equal(c.campaign.caption, 'Join us');
});
