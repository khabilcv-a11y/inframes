/** Cloudflare Turnstile check. Dormant (always passes) until TURNSTILE_SECRET is configured. */
export async function turnstileOk(secret: string | undefined, token: string | undefined, ip: string | null): Promise<boolean> {
  if (!secret) return true;
  if (!token) return false;
  const body = new FormData();
  body.set('secret', secret);
  body.set('response', token);
  if (ip) body.set('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    return ((await res.json()) as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}
