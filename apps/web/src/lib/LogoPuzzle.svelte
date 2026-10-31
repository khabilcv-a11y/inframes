<script lang="ts">
  import { onMount } from 'svelte';

  // The InFrame wordmark is built from thousands of loose characters. They spring home, the cursor
  // pushes them away, a click scatters them, and four coral viewfinder corners can be dragged into
  // place to "snap the frame" (camera flash). Reduced-motion visitors get the finished state.
  // `text` is what the loose characters spell; `compact` is the slim banner used on campaign pages.
  let { text = 'InFrame', compact = false, onsolved }: { text?: string; compact?: boolean; onsolved?: () => void } = $props();

  type P = { x: number; y: number; vx: number; vy: number; hx: number; hy: number; ch: string; a: number };
  type Corner = { id: 'tl' | 'tr' | 'bl' | 'br'; x: number; y: number; tx: number; ty: number; snapped: boolean; drag: boolean };

  const CHARS = 'INFRAME@#10';
  const SIZE = compact ? 30 : 46; // corner piece size
  let wrap = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let corners = $state<Corner[]>([]);
  let solved = $state(false);
  let flash = $state(false);
  let reduce = false;

  let particles: P[] = [];
  let W = 0, H = 0, raf = 0, running = false, dpr = 1, glyph = 12, wordmark = '', lines: string[] = [text], lh = 0;
  let pointer = { x: -999, y: -999, down: false };
  let textBox = { x: 0, y: 0, w: 0, h: 0 };
  const dragOff = { x: 0, y: 0 };

  function build() {
    if (!wrap || !canvas) return;
    const r = wrap.getBoundingClientRect();
    W = r.width; H = r.height; dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr; canvas.height = H * dpr;

    // Rasterise the wordmark and sample it into character particles.
    const off = document.createElement('canvas'); off.width = W; off.height = H;
    const o = off.getContext('2d', { willReadFrequently: true })!;
    const stack = '"Space Grotesk", "Noto Sans Malayalam", "Mukta", sans-serif';
    // Long campaign titles go on two lines so the letters stay big enough to read.
    lines = [text];
    if (compact && text.includes(' ') && text.length > 12) {
      const mid = text.length / 2;
      let cut = -1;
      for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (cut < 0 || Math.abs(i - mid) < Math.abs(cut - mid))) cut = i;
      lines = [text.slice(0, cut), text.slice(cut + 1)];
    }
    o.font = `700 100px ${stack}`;
    const per100 = Math.max(1, ...lines.map((l) => o.measureText(l).width));
    const fs = Math.max(14, Math.min(compact ? 90 : 150, W * 0.2 * (compact ? 1.6 : 1), (W * 0.84 * 100) / per100, (H * (compact ? 0.62 : 0.5)) / (lines.length * 1.12)));
    lh = fs * 1.12;
    o.font = `700 ${fs}px ${stack}`;
    o.textAlign = 'center'; o.textBaseline = 'middle'; o.fillStyle = '#fff';
    lines.forEach((l, i) => o.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * lh));
    const tw = Math.max(...lines.map((l) => o.measureText(l).width));
    textBox = { x: W / 2 - tw / 2, y: H / 2 - ((lines.length - 1) / 2) * lh - fs * 0.38, w: tw, h: (lines.length - 1) * lh + fs * 0.76 };
    const img = o.getImageData(0, 0, W, H).data;

    const cap = W < 600 ? 420 : 1000;
    let step = 5, pts: [number, number][] = [];
    do {
      pts = [];
      for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) if (img[(Math.floor(y) * Math.floor(W) + Math.floor(x)) * 4 + 3] > 140) pts.push([x, y]);
      step++;
    } while (pts.length > cap);
    glyph = Math.max(9, Math.round((step - 1) * 1.15));
    wordmark = `700 ${fs}px ${stack}`;

    particles = pts.map(([hx, hy]) => ({
      hx, hy, x: reduce ? hx : Math.random() * W, y: reduce ? hy : Math.random() * H, vx: 0, vy: 0,
      ch: CHARS[Math.floor(Math.random() * CHARS.length)], a: 0.55 + Math.random() * 0.45
    }));

    const pad = 26;
    const T = { tl: [textBox.x - pad, textBox.y - pad], tr: [textBox.x + textBox.w + pad - SIZE, textBox.y - pad], bl: [textBox.x - pad, textBox.y + textBox.h + pad - SIZE], br: [textBox.x + textBox.w + pad - SIZE, textBox.y + textBox.h + pad - SIZE] } as const;
    corners = (['tl', 'tr', 'bl', 'br'] as const).map((id) => ({
      id, tx: T[id][0], ty: T[id][1], snapped: reduce || solved,
      x: reduce || solved ? T[id][0] : 12 + Math.random() * Math.max(10, W - SIZE - 24), y: reduce || solved ? T[id][1] : (id[0] === 't' ? 8 : H - SIZE - 34) + (Math.random() - 0.5) * 24,
      drag: false
    }));
  }

  /** The solid wordmark (one or two lines) used as a faint underlay and for the static state. */
  function drawLines(ctx: CanvasRenderingContext2D) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * lh));
  }

  function frame() {
    const ctx = canvas!.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // faint solid wordmark so the logo always reads clearly, whatever the letters are doing
    ctx.font = wordmark; ctx.fillStyle = solved ? 'rgba(232,85,61,.24)' : compact ? 'rgba(255,255,255,.2)' : 'rgba(255,255,255,.10)';
    drawLines(ctx);
    ctx.font = `600 ${glyph}px "Space Grotesk", monospace`;
    const R = 95, R2 = R * R;
    for (const p of particles) {
      const dx = p.x - pointer.x, dy = p.y - pointer.y, d2 = dx * dx + dy * dy;
      if (d2 < R2 && !reduce) { const d = Math.sqrt(d2) || 1, f = (1 - d / R) * 5.5; p.vx += (dx / d) * f; p.vy += (dy / d) * f; }
      p.vx += (p.hx - p.x) * 0.045; p.vy += (p.hy - p.y) * 0.045;
      p.vx *= 0.84; p.vy *= 0.84;
      p.x += p.vx; p.y += p.vy;
      const speed = Math.min(1, Math.abs(p.vx) + Math.abs(p.vy));
      ctx.fillStyle = solved ? `rgba(232,85,61,${0.6 + speed * 0.4})` : `rgba(255,255,255,${p.a * (0.7 + speed * 0.3)})`;
      ctx.fillText(p.ch, p.x, p.y);
    }
    raf = requestAnimationFrame(frame);
  }
  const start = () => { if (!running && !reduce) { running = true; raf = requestAnimationFrame(frame); } };
  const stop = () => { running = false; cancelAnimationFrame(raf); };

  function drawStatic() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.font = wordmark; ctx.fillStyle = solved ? 'rgba(232,85,61,.9)' : '#ffffff'; drawLines(ctx);
    ctx.font = `600 ${glyph}px "Space Grotesk", monospace`;
    ctx.fillStyle = solved ? '#E8553D' : '#ffffff';
    for (const p of particles) ctx.fillText(p.ch, p.x, p.y);
  }

  function scatter(x: number, y: number) {
    for (const p of particles) {
      const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy) || 1;
      const f = 14 + Math.random() * 10;
      p.vx += (dx / d) * f + (Math.random() - 0.5) * 8; p.vy += (dy / d) * f + (Math.random() - 0.5) * 8;
    }
  }

  const local = (e: PointerEvent) => { const r = wrap!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function move(e: PointerEvent) { const p = local(e); pointer.x = p.x; pointer.y = p.y; }
  function leave() { pointer.x = pointer.y = -999; }
  function canvasDown(e: PointerEvent) { const p = local(e); pointer.down = true; scatter(p.x, p.y); }

  function cornerDown(e: PointerEvent, c: Corner) {
    if (c.snapped) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = local(e); dragOff.x = p.x - c.x; dragOff.y = p.y - c.y; c.drag = true;
  }
  function cornerMove(e: PointerEvent, c: Corner) {
    if (!c.drag) return;
    const p = local(e); c.x = Math.max(0, Math.min(W - SIZE, p.x - dragOff.x)); c.y = Math.max(0, Math.min(H - SIZE - 28, p.y - dragOff.y));
  }
  function cornerUp(c: Corner) {
    if (!c.drag) return;
    c.drag = false;
    if (Math.hypot(c.x - c.tx, c.y - c.ty) < 48) { c.x = c.tx; c.y = c.ty; c.snapped = true; check(); }
  }
  function check() {
    if (corners.every((c) => c.snapped) && !solved) win();
  }
  function win() {
    solved = true; flash = true; onsolved?.();
    setTimeout(() => (flash = false), 520);
    if (reduce) drawStatic();
  }
  function solve() { for (const c of corners) { c.x = c.tx; c.y = c.ty; c.snapped = true; } win(); }
  function shuffle() { solved = false; build(); if (reduce) drawStatic(); }

  onMount(() => {
    reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const go = () => { build(); if (reduce) { solved = true; drawStatic(); } else start(); };
    (Promise.all([document.fonts?.load('700 100px "Space Grotesk"', text), document.fonts?.load('700 100px "Noto Sans Malayalam"', text), document.fonts?.load('700 100px "Mukta"', text)]) ?? Promise.resolve()).then(go, go);
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()), { threshold: 0.05 });
    io.observe(wrap!);
    let t: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { build(); if (reduce) drawStatic(); }, 150); });
    ro.observe(wrap!);
    return () => { stop(); io.disconnect(); ro.disconnect(); };
  });
</script>

<div class="wrap" class:compact bind:this={wrap} role="group" aria-label="Interactive InFrame logo puzzle">
  <canvas bind:this={canvas} style="width:100%; height:100%" onpointermove={move} onpointerleave={leave} onpointerdown={canvasDown} onpointerup={() => (pointer.down = false)} aria-hidden="true"></canvas>

  {#each corners as c (c.id)}
    <div class="corner {c.id}" class:snapped={c.snapped} class:drag={c.drag} style="left:{c.x}px; top:{c.y}px; width:{SIZE}px; height:{SIZE}px"
      role="presentation" onpointerdown={(e) => cornerDown(e, c)} onpointermove={(e) => cornerMove(e, c)} onpointerup={() => cornerUp(c)} onpointercancel={() => cornerUp(c)}></div>
  {/each}

  {#if solved}<span class="rec" style="left:{textBox.x + textBox.w + 40}px; top:{textBox.y + 6}px" aria-hidden="true"></span>{/if}
  <div class="flash" class:on={flash} aria-hidden="true"></div>

  <p class="hint" aria-live="polite">
    {#if solved}You’re in the frame. 📸{:else if compact}Touch the letters. Drag the corners to frame it.{:else}Drag the four corners around the logo. Move your cursor through the letters. Click to scatter.{/if}
  </p>
  <div class="ctl">
    {#if !solved}<button class="sm" onclick={solve}>Snap it for me</button>{:else}<button class="sm" onclick={shuffle}>Play again</button>{/if}
  </div>
</div>

<style>
  .wrap { position: relative; height: clamp(240px, 38vw, 360px); width: 100%; user-select: none; -webkit-user-select: none; overflow: hidden; }
  .wrap.compact { height: clamp(190px, 48vw, 230px); background: var(--ink); border-radius: 16px; margin: 4px 0 12px; }
  .compact .hint { font-size: .72rem; bottom: 4px; }
  .compact .tl, .compact .tr, .compact .bl, .compact .br { border-width: 0; }
  .compact .tl { border-top-width: 4px; border-left-width: 4px; } .compact .tr { border-top-width: 4px; border-right-width: 4px; }
  .compact .bl { border-bottom-width: 4px; border-left-width: 4px; } .compact .br { border-bottom-width: 4px; border-right-width: 4px; }
  canvas { display: block; touch-action: pan-y; cursor: crosshair; }
  .corner { position: absolute; touch-action: none; cursor: grab; border: 0 solid var(--coral); filter: drop-shadow(0 0 8px rgb(232 85 61 / 45%)); transition: transform .12s; z-index: 2; }
  .corner:not(.snapped):hover { transform: scale(1.12); }
  .corner.drag { cursor: grabbing; transform: scale(1.18); }
  .corner.snapped { cursor: default; filter: none; transition: left .25s cubic-bezier(.34, 1.56, .64, 1), top .25s cubic-bezier(.34, 1.56, .64, 1); }
  .tl { border-top-width: 6px; border-left-width: 6px; border-top-left-radius: 8px; }
  .tr { border-top-width: 6px; border-right-width: 6px; border-top-right-radius: 8px; }
  .bl { border-bottom-width: 6px; border-left-width: 6px; border-bottom-left-radius: 8px; }
  .br { border-bottom-width: 6px; border-right-width: 6px; border-bottom-right-radius: 8px; }
  /* generous invisible grab area on touch screens */
  .corner::after { content: ''; position: absolute; inset: -14px; }
  .rec { position: absolute; width: 16px; height: 16px; border-radius: 50%; background: #ff3b30; animation: blink 1.1s infinite; }
  @keyframes blink { 0%, 55% { opacity: 1; } 75%, 100% { opacity: .15; } }
  .flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; z-index: 3; }
  .flash.on { opacity: .95; animation: fade .5s ease-out forwards; }
  @keyframes fade { to { opacity: 0; } }
  .hint { position: absolute; left: 0; right: 0; bottom: 6px; margin: 0; text-align: center; color: #9a9aa6; font-size: .82rem; pointer-events: none; padding: 0 12px; }
  .ctl { position: absolute; right: 8px; top: 8px; z-index: 4; }
  .compact .ctl button { min-height: 30px; font-size: .75rem; padding: 0 10px; }
  .ctl button { background: rgb(255 255 255 / 8%); color: #d9d9e0; border-color: #3a3a44; }
  .ctl button:hover:not(:disabled) { background: rgb(255 255 255 / 16%); }
</style>
