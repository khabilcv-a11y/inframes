// Copies the onnxruntime-web runtime files into static/ort so the site serves them itself (no CDN at run time).
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const dist = dirname(createRequire(import.meta.url).resolve('onnxruntime-web'));
const out = new URL('../static/ort/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
for (const f of readdirSync(dist)) if (/^(ort-wasm-simd-threaded\.(wasm|mjs)|ort\.wasm\.min\.mjs)$/.test(f)) cpSync(join(dist, f), join(out, f));
