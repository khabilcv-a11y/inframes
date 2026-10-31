import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  // `pnpm dev:api` serves the Worker on :8787; same-origin /api in dev mirrors production routing.
  server: { proxy: { '/api': 'http://localhost:8787' } }
});
