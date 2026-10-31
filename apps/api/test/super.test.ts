import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/index.ts';
import { hashPassword } from '../src/lib/crypto.ts';
import { makeDb } from './d1shim.ts';

const env0 = { SESSION_SECRET: 'test-secret-test-secret-test-secret-1234' };

async function setup() {
  const { db, sql } = makeDb();
  const hash = await hashPassword('correct-horse-1', 1000);
  const ins = sql.prepare("INSERT INTO users (id,name,email,role,password_hash,status,must_change_password,created_at) VALUES (?,?,?,?,?,'active',0,'2026-01-01')");
  ins.run('S1', 'Root', 'root@x.in', 'super_admin', hash);
  const env = { ...env0, DB: db };
  const req = (path: string, init: RequestInit = {}, cookie?: string) =>
    app.request(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } }, env);
  const loginAs = async (email: string, password: string) =>
    (await req('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })).headers.get('set-cookie')!.split(';')[0];
  return { sql, req, loginAs, cookie: await loginAs('root@x.in', 'correct-horse-1') };
}
const j = (o: unknown) => JSON.stringify(o);

test('org and admin lifecycle, audited, new admin forced to change password', async () => {
  const { req, cookie, loginAs, sql } = await setup();
  const o = await req('/super/organisations', { method: 'POST', body: j({ name: 'DCIP Kozhikode' }) }, cookie);
  assert.equal(o.status, 201);
  const { id: orgId } = (await o.json()) as { id: string };

  const a = await req('/super/admins', { method: 'POST', body: j({ name: 'Asha', email: 'Asha@X.in', orgId, role: 'manager' }) }, cookie);
  assert.equal(a.status, 201);
  const { id, temporaryPassword } = (await a.json()) as { id: string; temporaryPassword: string };

  const adminCookie = await loginAs('asha@x.in', temporaryPassword);
  const me = (await (await req('/auth/me', {}, adminCookie)).json()) as any;
  assert.equal(me.user.mustChangePassword, true);
  assert.equal(me.user.orgId, orgId);

  assert.equal((await req('/super/admins/' + id, { method: 'PATCH', body: j({ action: 'suspend' }) }, cookie)).status, 200);
  assert.equal((await req('/auth/me', {}, adminCookie)).status, 401);

  const list = (await (await req('/super/admins', {}, cookie)).json()) as any;
  assert.equal(list.admins[0].orgName, 'DCIP Kozhikode');
  assert.equal(list.admins[0].status, 'suspended');

  const actions = (sql.prepare('SELECT action FROM audit_log WHERE user_id = ? ORDER BY id').all('S1') as { action: string }[]).map((r) => r.action);
  assert.ok(['org.create', 'admin.create', 'admin.suspend'].every((x) => actions.includes(x)));
});

test('non-super-admins and anonymous users are rejected', async () => {
  const { req, cookie, loginAs } = await setup();
  assert.equal((await req('/super/admins')).status, 401);
  const { id: orgId } = (await (await req('/super/organisations', { method: 'POST', body: j({ name: 'CGPC Devagiri' }) }, cookie)).json()) as { id: string };
  const { temporaryPassword } = (await (await req('/super/admins', { method: 'POST', body: j({ name: 'Rahul', email: 'rahul@x.in', orgId, role: 'viewer' }) }, cookie)).json()) as { temporaryPassword: string };
  const adminCookie = await loginAs('rahul@x.in', temporaryPassword);
  // must change password first, then still forbidden for super routes
  assert.equal((await req('/super/admins', {}, adminCookie)).status, 403);
});

test('duplicate email, bad org and reset password', async () => {
  const { req, cookie, loginAs } = await setup();
  const { id: orgId } = (await (await req('/super/organisations', { method: 'POST', body: j({ name: 'Org' }) }, cookie)).json()) as { id: string };
  const mk = (email: string, org = orgId) => req('/super/admins', { method: 'POST', body: j({ name: 'Zed', email, orgId: org, role: 'manager' }) }, cookie);
  const first = (await (await mk('z@x.in')).json()) as { id: string };
  assert.equal((await mk('z@x.in')).status, 409);
  assert.equal((await mk('y@x.in', 'nope')).status, 404);
  const r = await req('/super/admins/' + first.id, { method: 'PATCH', body: j({ action: 'reset_password' }) }, cookie);
  const { temporaryPassword } = (await r.json()) as { temporaryPassword: string };
  assert.ok((await loginAs('z@x.in', temporaryPassword)).startsWith('inframe_session='));
});
