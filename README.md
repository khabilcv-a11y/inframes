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

## Deploying (Cloudflare Pages, auto-deploy from GitHub)
The API runs inside the Pages project (`apps/web/src/hooks.server.ts` serves `/api/*`), so the site and API share one origin.
1. `npx wrangler d1 create inframe` → put the id in `apps/web/wrangler.toml`
2. Apply migrations: `cd apps/web && npx wrangler d1 migrations apply inframe --remote`
3. Pages project → Settings → Builds: connect this GitHub repo; root directory `/`;
   build command `pnpm install --frozen-lockfile && pnpm --filter @inframe/web build`;
   output directory `apps/web/.svelte-kit/cloudflare`; production branch as chosen.
4. Pages → Settings → Variables and Secrets: add secret `SESSION_SECRET` (random 32+ chars);
   Bindings: D1 database `DB` → `inframe`.
5. Seed the super admin once with `--remote` (see Local development), then sign in at `/admin/login`.
Every push to the production branch redeploys automatically.

## Status
Milestone 1 (foundation) done. Milestone 2 in progress: super admin organisations and admins done; campaign builder, template upload, Drive connection and scheduler next.
