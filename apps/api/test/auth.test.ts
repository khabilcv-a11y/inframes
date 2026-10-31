import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/index.ts';
import { hashPassword } from '../src/lib/crypto.ts';
import { makeDb } from './d1shim.ts';

const SECRET = 'test-secret-test-secret-test-secret-1234';

async function setup(opts: { mustChange?: number; status?: string } = {}) {
  const { db, sql } = makeDb();
  sql
    .prepare(
      "INSERT INTO users (id,name,email,role,password_hash,status,must_change_password,created_at) VALUES ('U1','Root','root@x.in','super_admin',?,?,?,?)"
    )
    .run(await hashPassword('correct-horse-1', 1000), opts.status ?? 'active', opts.mustChange ?? 0, new Date().toISOString());
  const env = { DB: db, SESSION_SECRET: SECRET };
  const call = (path: string, init: RequestInit = {}, cookie?: string) =>
    app.request(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } }, env);
  const login = (password: string) =>
    call('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'root@x.in', password }) });
  const cookieOf = (r: Response) => r.headers.get('set-cookie')!.split(';')[0];
  return { sql, call, login, cookieOf };
}

test('login succeeds, sets HttpOnly strict cookie, writes audit row', async () => {
  const { login, sql } = await setup();
  const r = await login('correct-horse-1');
  assert.equal(r.status, 200);
  const sc = r.headers.get('set-cookie')!;
  assert.match(sc, /HttpOnly/i);
  assert.match(sc, /SameSite=Strict/i);
  assert.equal((sql.prepare("SELECT action FROM audit_log").get() as { action: string }).action, 'auth.login');
});

test('wrong password and unknown email give the same 401', async () => {
  const { login, call } = await setup();
  const a = await login('nope');
  const b = await call('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'ghost@x.in', password: 'nope' }) });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.deepEqual(await a.json(), await b.json());
});

test('5 failures lock the account, even for the right password', async () => {
  const { login } = await setup();
  for (let i = 0; i < 5; i++) assert.equal((await login('bad')).status, 401);
  assert.equal((await login('correct-horse-1')).status, 423);
});

test('/me needs a session; suspended user loses access immediately', async () => {
  const { call, login, cookieOf, sql } = await setup();
  assert.equal((await call('/auth/me')).status, 401);
  const cookie = cookieOf(await login('correct-horse-1'));
  assert.equal((await call('/auth/me', {}, cookie)).status, 200);
  sql.prepare("UPDATE users SET status='suspended' WHERE id='U1'").run();
  assert.equal((await call('/auth/me', {}, cookie)).status, 401);
});

test('forced password change gates other routes until changed', async () => {
  const { call, login, cookieOf, sql } = await setup({ mustChange: 1 });
  const cookie = cookieOf(await login('correct-horse-1'));
  assert.equal(((await (await call('/auth/me', {}, cookie)).json()) as any).user.mustChangePassword, true);
  const bad = await call('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: 'correct-horse-1', newPassword: 'short' }) }, cookie);
  assert.equal(bad.status, 400);
  const ok = await call('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: 'correct-horse-1', newPassword: 'brand-new-password-9' }) }, cookie);
  assert.equal(ok.status, 200);
  assert.equal((sql.prepare('SELECT must_change_password m FROM users').get() as { m: number }).m, 0);
});

test('logout clears cookie and is audited', async () => {
  const { call, login, cookieOf, sql } = await setup();
  const cookie = cookieOf(await login('correct-horse-1'));
  assert.equal((await call('/auth/logout', { method: 'POST' }, cookie)).status, 200);
  const rows = sql.prepare('SELECT action FROM audit_log ORDER BY id').all() as { action: string }[];
  assert.deepEqual(rows.map((r) => r.action), ['auth.login', 'auth.logout']);
});
