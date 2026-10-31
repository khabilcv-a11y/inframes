import type { Role } from '@inframe/shared';

export interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
}

export interface UserRow {
  id: string;
  org_id: string | null;
  name: string;
  email: string;
  role: Role;
  password_hash: string | null;
  status: 'invited' | 'active' | 'suspended';
  must_change_password: number;
  failed_logins: number;
  locked_until: string | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: UserRow };
};
