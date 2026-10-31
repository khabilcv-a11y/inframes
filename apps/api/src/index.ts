import { Hono } from 'hono';
import type { AppEnv } from './types.ts';
import { auth } from './routes/auth.ts';
import { superRoutes } from './routes/super.ts';

export const app = new Hono<AppEnv>().basePath('/api');

app.get('/health', (c) => c.json({ ok: true }));
app.route('/auth', auth);
app.route('/super', superRoutes);

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'server_error' }, 500);
});

export default app;
