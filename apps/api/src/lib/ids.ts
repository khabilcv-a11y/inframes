const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

/** Time-sortable id: 10 chars of millisecond time + 16 random chars (ULID layout). */
export function ulid(now = Date.now()): string {
  let t = '';
  for (let n = now, i = 0; i < 10; i++, n = Math.floor(n / 32)) t = ALPHABET[n % 32] + t;
  const r = crypto.getRandomValues(new Uint8Array(16));
  return t + Array.from(r, (b) => ALPHABET[b % 32]).join('');
}

/** Readable one-time password, no look-alike characters. */
export function tempPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(r, (b) => chars[b % chars.length]).join('');
}
