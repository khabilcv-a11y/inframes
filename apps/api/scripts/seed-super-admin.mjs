// Prints SQL that creates the super admin. Usage:
//   SUPER_EMAIL=you@example.com SUPER_PASSWORD='a-long-temp-password' node scripts/seed-super-admin.mjs > seed.sql
//   wrangler d1 execute inframe --remote --file seed.sql   (then delete seed.sql)
// The account is forced to change this password at first login.
const email = process.env.SUPER_EMAIL?.trim().toLowerCase();
const password = process.env.SUPER_PASSWORD;
const name = process.env.SUPER_NAME ?? 'Super Admin';
if (!email || !password || password.length < 10) {
  console.error('Set SUPER_EMAIL and SUPER_PASSWORD (min 10 chars).');
  process.exit(1);
}
const ITER = 100_000;
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256));
const b64 = (u) => Buffer.from(u).toString('base64');
const hash = `pbkdf2$${ITER}$${b64(salt)}$${b64(bits)}`;
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const id = 'SUPER' + Date.now().toString(36).toUpperCase();
console.log(
  `INSERT INTO users (id, org_id, name, email, role, password_hash, status, must_change_password, created_at) VALUES (${q(id)}, NULL, ${q(name)}, ${q(email)}, 'super_admin', ${q(hash)}, 'active', 1, ${q(new Date().toISOString())});`
);
