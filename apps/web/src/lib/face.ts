/**
 * Face finding and face signatures, entirely in the browser (onnxruntime-web, WebAssembly).
 * Models: YuNet (detector) and SFace (128-number signature), both from the OpenCV Zoo under permissive licences.
 * The same code runs on the organiser's computer (event photos) and on a participant's phone (selfie),
 * so signatures are comparable. Verified against OpenCV's own pipeline (see docs/SPEC.md).
 */
type Ort = typeof import('onnxruntime-web');
type Session = import('onnxruntime-web').InferenceSession;

export interface Face { x: number; y: number; w: number; h: number; score: number; pts: [number, number][] }
export type Source = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

const TEMPLATE: [number, number][] = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];
const SIZE = 640, SCORE = 0.6, NMS = 0.3, MIN_FACE = 28;

let ready: Promise<{ ort: Ort; det: Session; rec: Session }> | null = null;

async function bytes(urls: string[], onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let done = 0;
  for (const u of urls) {
    const r = await fetch(u, { cache: 'force-cache' });
    if (!r.ok) throw new Error('model_download_failed');
    const b = new Uint8Array(await r.arrayBuffer());
    parts.push(b); done += b.length; onProgress?.(done, 38_930_000);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Downloads the models once (about 50 MB the first time, then cached by the browser). */
export function loadFaceModels(onProgress?: (fraction: number) => void) {
  ready ??= (async () => {
    // loaded from our own /ort folder at run time (kept out of the bundle; see scripts/copy-ort.mjs)
    const ort = (await import(/* @vite-ignore */ `${location.origin}/ort/ort.wasm.min.mjs`)) as Ort;
    ort.env.wasm.wasmPaths = '/ort/';
    ort.env.wasm.numThreads = 1;
    ort.env.logLevel = 'error';
    const det = await ort.InferenceSession.create(await bytes(['/models/yunet.onnx']), { executionProviders: ['wasm'], logSeverityLevel: 3 });
    const rec = await ort.InferenceSession.create(await bytes(['/models/sface.onnx.part0', '/models/sface.onnx.part1'], (d, t) => onProgress?.(Math.min(1, d / t))), { executionProviders: ['wasm'], logSeverityLevel: 3 });
    return { ort, det, rec };
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

const scratch = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const iou = (a: Face, b: Face) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter + 1e-9);
};

/** One detector pass over a region of the picture (letterboxed into 640×640). Coordinates come back in picture pixels. */
async function detectRegion(src: Source, rx: number, ry: number, rw: number, rh: number, imgW: number, imgH: number): Promise<Face[]> {
  const { ort, det } = await loadFaceModels();
  const k = SIZE / Math.max(rw, rh);
  const c = scratch(SIZE, SIZE);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, rx, ry, rw, rh, 0, 0, Math.max(1, Math.round(rw * k)), Math.max(1, Math.round(rh * k)));
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const n = SIZE * SIZE, input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { input[i] = px[i * 4 + 2]; input[n + i] = px[i * 4 + 1]; input[2 * n + i] = px[i * 4]; } // BGR planes, 0..255
  const out = await det.run({ input: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
  const faces: Face[] = [];
  for (const s of [8, 16, 32]) {
    const g = SIZE / s;
    const cls = out[`cls_${s}`].data as Float32Array, obj = out[`obj_${s}`].data as Float32Array;
    const bb = out[`bbox_${s}`].data as Float32Array, kp = out[`kps_${s}`].data as Float32Array;
    for (let i = 0; i < g * g; i++) {
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
      if (score < SCORE) continue;
      const col = i % g, row = (i - col) / g;
      const cx = (col + bb[i * 4]) * s, cy = (row + bb[i * 4 + 1]) * s, w = Math.exp(bb[i * 4 + 2]) * s, h = Math.exp(bb[i * 4 + 3]) * s;
      const pts: [number, number][] = [];
      for (let j = 0; j < 5; j++) pts.push([rx + ((kp[i * 10 + 2 * j] + col) * s) / k, ry + ((kp[i * 10 + 2 * j + 1] + row) * s) / k]);
      const f: Face = { x: rx + (cx - w / 2) / k, y: ry + (cy - h / 2) / k, w: w / k, h: h / k, score, pts };
      // a face cut off by the inside edge of a tile is dropped: the neighbouring tile sees it whole
      const m = 2 / k;
      const cut = (f.x <= rx + m && rx > 0) || (f.y <= ry + m && ry > 0) || (f.x + f.w >= rx + rw - m && rx + rw < imgW) || (f.y + f.h >= ry + rh - m && ry + rh < imgH);
      if (!cut) faces.push(f);
    }
  }
  return faces;
}

/** Finds every face. Big pictures are also searched in overlapping tiles so small faces in group shots are found. */
export async function detectFaces(src: Source): Promise<Face[]> {
  const W = src.width, H = src.height;
  let all = await detectRegion(src, 0, 0, W, H, W, H);
  const long = Math.max(W, H);
  const grid = long > 3200 ? 3 : long > 1280 ? 2 : 1;
  if (grid > 1) {
    const tw = Math.ceil((W / grid) * 1.3), th = Math.ceil((H / grid) * 1.3);
    for (let gy = 0; gy < grid; gy++) for (let gx = 0; gx < grid; gx++) {
      const x = Math.round(((W - tw) * gx) / (grid - 1)), y = Math.round(((H - th) * gy) / (grid - 1));
      all = all.concat(await detectRegion(src, x, y, tw, th, W, H));
    }
  }
  all.sort((a, b) => b.score - a.score);
  const keep: Face[] = [];
  for (const f of all) if (f.w >= MIN_FACE && keep.every((q) => iou(f, q) < NMS)) keep.push(f);
  return keep;
}

/** Least-squares similarity transform taking the face's five landmarks onto the model's template. */
function similarity(pts: [number, number][]) {
  const mean = (a: [number, number][]) => [a.reduce((n, p) => n + p[0], 0) / a.length, a.reduce((n, p) => n + p[1], 0) / a.length];
  const ms = mean(pts), md = mean(TEMPLATE);
  let a = 0, b = 0, n = 0;
  for (let i = 0; i < 5; i++) {
    const sx = pts[i][0] - ms[0], sy = pts[i][1] - ms[1], dx = TEMPLATE[i][0] - md[0], dy = TEMPLATE[i][1] - md[1];
    a += sx * dx + sy * dy; b += sx * dy - sy * dx; n += sx * sx + sy * sy;
  }
  const sc = a / n, ss = b / n;
  return { sc, ss, tx: md[0] - (sc * ms[0] - ss * ms[1]), ty: md[1] - (ss * ms[0] + sc * ms[1]) };
}

/** The 128-number signature of one face (unit length, so the dot product of two signatures is their similarity). */
export async function faceSignature(src: Source, face: Face): Promise<Float32Array> {
  const { ort, rec } = await loadFaceModels();
  const { sc, ss, tx, ty } = similarity(face.pts);
  const c = scratch(112, 112);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(sc, ss, -ss, sc, tx, ty);
  ctx.drawImage(src, 0, 0);
  const px = ctx.getImageData(0, 0, 112, 112).data;
  const n = 112 * 112, input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { input[i] = px[i * 4]; input[n + i] = px[i * 4 + 1]; input[2 * n + i] = px[i * 4 + 2]; } // RGB planes, 0..255
  const e = (await rec.run({ data: new ort.Tensor('float32', input, [1, 3, 112, 112]) })).fc1.data as Float32Array;
  let norm = 0; for (const v of e) norm += v * v; norm = Math.sqrt(norm) || 1;
  return Float32Array.from(e, (v) => v / norm);
}

export async function openImage(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

/** A JPEG copy no larger than `maxSide`, at most `maxBytes` (quality steps down if needed). */
export async function jpegCopy(src: Source, maxSide: number, maxBytes: number): Promise<Blob> {
  const k = Math.min(1, maxSide / Math.max(src.width, src.height));
  const c = scratch(Math.max(1, Math.round(src.width * k)), Math.max(1, Math.round(src.height * k)));
  const ctx = c.getContext('2d')!; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  for (const q of [0.86, 0.75, 0.62, 0.5]) {
    const b = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q));
    if (b && b.size <= maxBytes) return b;
  }
  throw new Error('image_too_large');
}
