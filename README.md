# InFrame

Branded photo/video frames for event campaigns. Full spec: [docs/SPEC.md](docs/SPEC.md).

## Layout
- `apps/api` — Cloudflare Worker (Hono) + D1 migrations
- `apps/web` — SvelteKit app (home, admin console; participant page in Milestone 3)
- `packages/shared` — types and zod schemas

## Local development
```bash
pnpm install
cd apps/api
echo 'SESSION_SECRET=any-long-random-string-32+chars' > .dev.vars
pnpm db:migrate:local
SUPER_EMAIL=you@example.com SUPER_PASSWORD='temp-password-123' pnpm seed:super > /tmp/seed.sql
npx wrangler d1 execute inframe --local --file /tmp/seed.sql && rm /tmp/seed.sql
pnpm dev            # API on :8787
# in another terminal, from repo root:
pnpm dev:web        # web on :5173, /api proxied to :8787
```
Sign in at `/admin/login`; you'll be asked to set a new password.

## Deploying (needs a Cloudflare account)
1. `wrangler d1 create inframe` → put the id in `apps/api/wrangler.toml`
2. `pnpm --filter @inframe/api db:migrate:remote`
3. `wrangler secret put SESSION_SECRET` (and optionally `TURNSTILE_SECRET`)
4. Seed the super admin against `--remote`, then `pnpm --filter @inframe/api deploy`
5. Create a Pages project for `apps/web`; route `yourdomain/api/*` to the Worker so the app and API share one origin (the session cookie is `SameSite=Strict`).

## Status
Milestone 1 (foundation): schema, login, lockout, sessions, forced password change, audit log — done.
