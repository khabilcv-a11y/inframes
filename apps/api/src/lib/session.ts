import { SignJWT, jwtVerify } from 'jose';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../types.ts';

export const SESSION_COOKIE = 'inframe_session';
export const IDLE_SECONDS = 12 * 60 * 60;

const key = (secret: string) => new TextEncoder().encode(secret);

export async function issueSession(c: Context<AppEnv>, userId: string) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${IDLE_SECONDS}s`)
    .sign(key(c.env.SESSION_SECRET));
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: IDLE_SECONDS
  });
}

export async function readSession(c: Context<AppEnv>): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(c.env.SESSION_SECRET), { algorithms: ['HS256'] });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export function clearSession(c: Context<AppEnv>) {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}
