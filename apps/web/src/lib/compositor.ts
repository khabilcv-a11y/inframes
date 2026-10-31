import type { Rect, SlotStyle } from '@inframe/shared';

export interface RenderSlot {
  id: string;
  box: Rect;
  style: SlotStyle;
}
export interface Transform { scale: number; x: number; y: number; rot: number }
export const IDENTITY: Transform = { scale: 1, x: 0, y: 0, rot: 0 };

export interface RenderOptions {
  width: number;
  height: number;
  frame: CanvasImageSource | null;
  photo: CanvasImageSource | null;
  photoSize?: { w: number; h: number };
  window: Rect;
  transform: Transform;
  slots: RenderSlot[];
  values: Record<string, string>;
  /** Preview-only aids */
  guides?: boolean;
}

export function applyCase(text: string, mode: SlotStyle['case']): string {
  if (mode === 'upper') return text.toLocaleUpperCase();
  if (mode === 'title') return text.toLocaleLowerCase().replace(/(^|[\s\-'.])(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase());
  return text;
}

/** Load every font used (and the actual glyphs) before drawing so Malayalam never flashes in a fallback. */
export async function ensureFonts(slots: RenderSlot[], values: Record<string, string>) {
  if (!('fonts' in document)) return;
  await Promise.all(
    slots.map((s) => document.fonts.load(`${s.style.weight} 40px "${s.style.font}"`, values[s.id] || 'Aa അ अ').catch(() => undefined))
  );
}

const fontStr = (st: SlotStyle, size: number) => `${st.weight} ${size}px "${st.font}", "Noto Sans Malayalam", "Mukta", sans-serif`;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] | null {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width <= maxW || !line) line = t;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines || lines.some((l) => ctx.measureText(l).width > maxW)) return null;
  return lines;
}

/** Start at the largest size and step down 2px until the text fits the box; ellipsis only as a last resort. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, box: Rect, st: SlotStyle): { size: number; lines: string[] } {
  for (let size = st.maxSize; size >= st.minSize; size -= 2) {
    ctx.font = fontStr(st, size);
    const lines = wrap(ctx, text, box.w, st.lines);
    if (lines && lines.length * size * 1.15 <= box.h) return { size, lines };
  }
  const size = st.minSize;
  ctx.font = fontStr(st, size);
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > box.w) t = t.slice(0, -1);
  return { size, lines: [t.length < text.length ? t.trimEnd() + '…' : t] };
}

function drawSilhouette(ctx: CanvasRenderingContext2D, w: Rect) {
  const g = ctx.createLinearGradient(w.x, w.y, w.x, w.y + w.h);
  g.addColorStop(0, '#d9d9d2'); g.addColorStop(1, '#b9b9b0');
  ctx.fillStyle = g;
  ctx.fillRect(w.x, w.y, w.w, w.h);
  ctx.fillStyle = '#f4f4ef';
  const cx = w.x + w.w / 2;
  ctx.beginPath(); ctx.arc(cx, w.y + w.h * 0.38, Math.min(w.w, w.h) * 0.17, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx, w.y + w.h * 0.98, w.w * 0.34, w.h * 0.36, 0, Math.PI, 0); ctx.fill();
}

export function render(ctx: CanvasRenderingContext2D, o: RenderOptions, scale = 1) {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, o.width, o.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, o.width, o.height);

  const w = o.window;
  ctx.save();
  ctx.beginPath(); ctx.rect(w.x, w.y, w.w, w.h); ctx.clip();
  if (o.photo && o.photoSize) {
    const cover = Math.max(w.w / o.photoSize.w, w.h / o.photoSize.h);
    const s = cover * o.transform.scale;
    ctx.translate(w.x + w.w / 2 + o.transform.x, w.y + w.h / 2 + o.transform.y);
    ctx.rotate(o.transform.rot);
    ctx.scale(s, s);
    ctx.drawImage(o.photo, -o.photoSize.w / 2, -o.photoSize.h / 2);
  } else drawSilhouette(ctx, w);
  ctx.restore();

  if (o.frame) ctx.drawImage(o.frame, 0, 0, o.width, o.height);

  for (const s of o.slots) {
    const raw = (o.values[s.id] ?? '').trim();
    if (!raw) continue;
    const st = s.style;
    const { size, lines } = fitText(ctx, applyCase(raw, st.case), s.box, st);
    ctx.font = fontStr(st, size);
    ctx.fillStyle = st.color;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = st.align;
    if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${st.tracking}px`;
    const lh = size * 1.15;
    const total = lines.length * lh;
    const top = st.valign === 'top' ? s.box.y : st.valign === 'bottom' ? s.box.y + s.box.h - total : s.box.y + (s.box.h - total) / 2;
    const x = st.align === 'left' ? s.box.x : st.align === 'right' ? s.box.x + s.box.w : s.box.x + s.box.w / 2;
    lines.forEach((l, i) => ctx.fillText(l, x, top + i * lh + size * 0.9));
    if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';
  }
  ctx.restore();
}

/** Bounding box of the transparent area of a frame: where the participant's photo will show. */
export function detectWindow(img: CanvasImageSource & { width: number; height: number }): Rect | null {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  const step = 2;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (data[(y * width + x) * 4 + 3] < 24) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: Math.min(width - minX, maxX - minX + step), h: Math.min(height - minY, maxY - minY + step) };
}

export function loadImage(src: string | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    img.onload = () => { if (typeof src !== 'string') URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => reject(new Error('image_load_failed'));
    img.src = url;
  });
}

/** Picked photos can be 50 MP: decode honouring EXIF rotation and downscale once if very large. */
export async function decodePhoto(file: Blob, maxSide = 4096): Promise<{ bitmap: ImageBitmap; w: number; h: number }> {
  let bm = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const long = Math.max(bm.width, bm.height);
  if (long > maxSide) {
    const k = maxSide / long;
    const small = await createImageBitmap(bm, { resizeWidth: Math.round(bm.width * k), resizeHeight: Math.round(bm.height * k), resizeQuality: 'high' });
    bm.close();
    bm = small;
  }
  return { bitmap: bm, w: bm.width, h: bm.height };
}

/**
 * Finds near-white, opaque, roughly rectangular areas in a frame design: the boxes a designer leaves
 * for text. Works on a quarter-size copy for speed; returns rectangles in the frame's own pixels.
 */
export function detectWhiteBoxes(img: CanvasImageSource & { width: number; height: number }): Rect[] {
  const S = 4;
  const w = Math.max(1, Math.floor(img.width / S)), h = Math.max(1, Math.floor(img.height / S));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], a = d[i * 4 + 3];
    mask[i] = a > 200 && Math.min(r, g, b) >= 214 && Math.max(r, g, b) - Math.min(r, g, b) <= 32 ? 1 : 0;
  }
  const seen = new Uint8Array(w * h);
  const out: Rect[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue;
    let minX = w, minY = h, maxX = 0, maxY = 0, n = 0;
    stack.push(start); seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p - x) / w;
      n++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1, area = bw * bh;
    const fill = n / area;
    if (area < 0.004 * w * h || area > 0.45 * w * h) continue; // too small (specks) or too big (background)
    if (bw < 0.07 * w || bh < 0.025 * h) continue;             // too thin to hold text
    if (fill < 0.78) continue;                                  // not rectangular enough
    const pad = 2;
    out.push({ x: (minX + pad) * S, y: (minY + pad) * S, w: Math.max(S, (bw - 2 * pad) * S), h: Math.max(S, (bh - 2 * pad) * S) });
  }
  // left to right within rows, rows top to bottom
  return out.sort((a, b) => (Math.abs(a.y - b.y) < 40 ? a.x - b.x : a.y - b.y)).slice(0, 8);
}
