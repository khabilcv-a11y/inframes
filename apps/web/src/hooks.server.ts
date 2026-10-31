import type { Handle } from '@sveltejs/kit';
import { app } from '@inframe/api';

// One deployment, one origin: /api/* is served by the Hono app with the Pages D1 binding,
// everything else by SvelteKit. This keeps the SameSite=Strict session cookie working on pages.dev.
export const handle: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith('/api/') && event.platform?.env) {
    return app.fetch(event.request, event.platform.env as never);
  }
  return resolve(event);
};
