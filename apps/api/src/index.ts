import { Hono } from 'hono';
import type { AppEnv } from './types.ts';
import { auth } from './routes/auth.ts';
import { superRoutes } from './routes/super.ts';
import { campaigns } from './routes/campaigns.ts';
import { templates } from './routes/templates.ts';
import { publicRoutes } from './routes/public.ts';
import { insights } from './routes/insights.ts';
import { images } from './routes/images.ts';
import { drive } from './routes/drive.ts';
import { uploads } from './routes/uploads.ts';

export const app = new Hono<AppEnv>().basePath('/api');

app.get('/health', (c) => c.json({ ok: true }));
app.route('/auth', auth);
app.route('/super', superRoutes);
app.route('/admin/campaigns', campaigns);
app.route('/', templates);
app.route('/', images);
app.route('/', drive);
app.route('/', uploads);
app.route('/', publicRoutes);
app.route('/', insights);

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'server_error' }, 500);
});

export default app;
