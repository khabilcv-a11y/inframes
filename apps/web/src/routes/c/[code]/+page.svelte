<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import type { Rect, SlotStyle } from '@inframe/shared';
  import { api } from '$lib/api';
  import { showIst } from '$lib/time';
  import { dict, type Key, type Lang } from '$lib/i18n';
  import Turnstile from '$lib/Turnstile.svelte';
  import CampaignCard, { type Card } from '$lib/CampaignCard.svelte';
  import { decodePhoto, ensureFonts, loadImage, render, IDENTITY, type RenderSlot, type Transform } from '$lib/compositor';

  type Slot = { id: string; label: string; inputType: 'text' | 'dropdown' | 'fixed'; options: string[]; fixedValue: string | null; required: boolean; box: Rect; style: SlotStyle; maxChars: number };
  type Tpl = { id: string; name: string; width: number; height: number; assetUrl: string; photoWindow: Rect; slots: Slot[] };
  type C = { title: string; description: string | null; language: Lang; organisation: string; orgSlug: string; logoUrl: string | null; more: Card[]; state: string; preview: boolean; startsAt: string; caption: string | null; hashtags: string | null; thankYou: string | null; ctaUrl: string | null; outputs: number; templates: Tpl[] };

  const code = page.params.code!;
  const preview = page.url.searchParams.get('preview') === '1';
  const q = preview ? '?preview=1' : '';

  let c = $state<C | null>(null);
  let missing = $state(false);
  let failed = $state(false);
  let lang = $state<Lang>('en');
  let step = $state<'landing' | 'edit' | 'done'>('landing');
  let tplId = $state('');
  let values = $state<Record<string, string>>({});
  let touched = $state(false);
  let busy = $state(false);
  let error = $state('');
  let result = $state<{ blob: Blob; url: string; serial: number } | null>(null);
  let copied = $state<'' | 'caption' | 'link'>('');
  let canvas = $state<HTMLCanvasElement>();
  let photo: { bitmap: ImageBitmap; w: number; h: number } | null = null;
  let frameImgs: Record<string, HTMLImageElement> = {};
  let tf: Transform = { ...IDENTITY };
  let raf = 0;
  let visitor = '';
  let siteKey = $state<string | null>(null);
  let botToken = $state('');
  let botReset = $state(0);

  const t = (k: Key) => dict[lang][k];
  const tpl = $derived(c?.templates.find((x) => x.id === tplId) ?? null);
  const fields = $derived(tpl?.slots.filter((s) => s.inputType !== 'fixed') ?? []);

  function vid() {
    try { let v = localStorage.getItem('inframe_vid'); if (!v) { v = crypto.randomUUID(); localStorage.setItem('inframe_vid', v); } return v; } catch { return crypto.randomUUID(); }
  }
  const track = (type: string, meta?: Record<string, string | number>) => {
    if (preview) return;
    fetch(`/api/c/${code}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visitorId: visitor, events: [{ type, meta }] }), keepalive: true }).catch(() => {});
  };

  onMount(async () => {
    visitor = vid();
    api<{ turnstileSiteKey: string | null }>('/config').then((r) => { if (r.ok) siteKey = r.data.turnstileSiteKey; });
    const r = await api<C>(`/c/${code}${q}`);
    if (!r.ok) { if (r.status === 404) missing = true; else failed = true; return; }
    c = r.data;
    lang = c.language; // set by the organiser in the campaign details
    tplId = c.templates[0]?.id ?? '';
    try { values = JSON.parse(localStorage.getItem(`inframe_vals_${code}`) ?? '{}'); } catch { values = {}; }
    for (const tp of c.templates) loadImage(tp.assetUrl).then((i) => { frameImgs[tp.id] = i; if (tp.id === tplId) draw(); });
    track('visit', { lang, ref: new URLSearchParams(location.search).get('r') ?? (document.referrer ? 'link' : 'direct') });
    await tick();
    draw();
  });

  /** Re-read the campaign (bypassing any cached copy) and keep the chosen frame if it still exists. */
  async function refresh() {
    const r = await api<C>(`/c/${code}${q ? q + '&' : '?'}_=${Date.now()}`);
    if (!r.ok) return;
    c = r.data;
    for (const tp of c.templates) if (!frameImgs[tp.id]) frameImgs[tp.id] = await loadImage(tp.assetUrl);
    if (!c.templates.some((x) => x.id === tplId)) tplId = c.templates[0]?.id ?? '';
    draw();
  }


  // ---- drawing ----
  function slotsFor(tp: Tpl): RenderSlot[] { return tp.slots.map((s) => ({ id: s.id, box: s.box, style: s.style })); }
  function valuesFor(tp: Tpl): Record<string, string> {
    const v: Record<string, string> = {};
    for (const s of tp.slots) v[s.id] = s.inputType === 'fixed' ? s.fixedValue ?? '' : (values[s.id] ?? '') || (step === 'landing' ? s.label : '');
    return v;
  }
  async function draw() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(async () => {
      if (!canvas || !tpl) return;
      const img = frameImgs[tpl.id];
      if (!img) return;
      const v = valuesFor(tpl);
      await ensureFonts(slotsFor(tpl), v);
      const k = Math.min(1, 720 / tpl.width);
      canvas.width = Math.round(tpl.width * k); canvas.height = Math.round(tpl.height * k);
      render(canvas.getContext('2d')!, { width: tpl.width, height: tpl.height, frame: img, photo: photo?.bitmap ?? null, photoSize: photo ? { w: photo.w, h: photo.h } : undefined, window: tpl.photoWindow, transform: tf, slots: slotsFor(tpl), values: v }, k);
    });
  }
  $effect(() => { JSON.stringify(values); tplId; step; draw(); });

  // ---- photo ----
  async function onPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    error = '';
    try {
      photo?.bitmap.close();
      photo = await decodePhoto(f);
      tf = { ...IDENTITY };
      step = 'edit';
      track('pick', { type: 'photo' });
      await tick();
      draw();
    } catch { error = t('error'); }
  }

  // ---- gestures: one finger moves, two fingers zoom and rotate, wheel zooms ----
  const pts = new Map<number, { x: number; y: number }>();
  let last: { d: number; a: number } | null = null;
  const dist = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x) }; };
  const clamp = (s: number) => Math.min(8, Math.max(1, s));
  function pdown(e: PointerEvent) { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) last = dist(); }
  function pmove(e: PointerEvent) {
    const p = pts.get(e.pointerId);
    if (!p || !tpl || !canvas) return;
    const k = tpl.width / canvas.getBoundingClientRect().width;
    if (pts.size === 1) { tf.x += (e.clientX - p.x) * k; tf.y += (e.clientY - p.y) * k; }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && last) { const n = dist(); tf.scale = clamp(tf.scale * (n.d / last.d)); tf.rot += n.a - last.a; last = n; }
    draw();
  }
  function pup(e: PointerEvent) { pts.delete(e.pointerId); last = null; }
  function wheel(e: WheelEvent) { e.preventDefault(); tf.scale = clamp(tf.scale * (e.deltaY < 0 ? 1.06 : 0.94)); draw(); }
  const zoom = (f: number) => { tf.scale = clamp(tf.scale * f); draw(); };
  const rotate = () => { tf.rot += Math.PI / 12; draw(); };
  const nudge = (dx: number, dy: number) => { tf.x += dx; tf.y += dy; draw(); };

  // ---- create ----
  function validate(): boolean {
    touched = true;
    return fields.every((s) => !s.required || (values[s.id] ?? '').trim());
  }
  async function create() {
    if (!tpl || !photo || !validate()) return;
    if (siteKey && !botToken) { error = t('error'); return; }
    busy = true; error = '';
    try {
      const img = frameImgs[tpl.id];
      const v = valuesFor(tpl);
      await ensureFonts(slotsFor(tpl), v);
      const off = document.createElement('canvas');
      off.width = tpl.width; off.height = tpl.height;
      render(off.getContext('2d')!, { width: tpl.width, height: tpl.height, frame: img, photo: photo.bitmap, photoSize: { w: photo.w, h: photo.h }, window: tpl.photoWindow, transform: tf, slots: slotsFor(tpl), values: v }, 1);
      const blob = await new Promise<Blob>((res, rej) => off.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.92));
      const slotValues = Object.fromEntries(tpl.slots.filter((s) => s.inputType !== 'fixed').map((s) => [s.id, (values[s.id] ?? '').trim()]));
      const r = await api<{ serial?: number; error?: string }>(`/c/${code}/outputs${q}`, { method: 'POST', body: JSON.stringify({ templateId: tpl.id, visitorId: visitor, slotValues, turnstileToken: botToken || undefined }) });
      botReset++;
      if (!r.ok) {
        if (r.data.error === 'bad_template') await refresh(); // the organiser just changed the frame
        error = r.data.error === 'rate_limited' ? t('tooMany') : t('error');
        return;
      }
      try { localStorage.setItem(`inframe_vals_${code}`, JSON.stringify(values)); } catch { /* ignore */ }
      result = { blob, url: URL.createObjectURL(blob), serial: r.data.serial ?? 0 };
      if (c) c.outputs += preview ? 0 : 1;
      track('create');
      step = 'done';
      window.scrollTo({ top: 0 });
    } catch { error = t('error'); track('error', { step: 'create' }); } finally { busy = false; }
  }

  // ---- share ----
  const fileName = () => `${code}-${result?.serial || 'frame'}.jpg`;
  const caption = $derived([c?.caption, c?.hashtags].filter(Boolean).join('\n\n'));
  async function share() {
    if (!result) return;
    const file = new File([result.blob], fileName(), { type: 'image/jpeg' });
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: caption || undefined }); track('share'); }
      else download();
    } catch { /* user dismissed the share sheet */ }
  }
  function download() {
    if (!result) return;
    const a = document.createElement('a'); a.href = result.url; a.download = fileName(); document.body.appendChild(a); a.click(); a.remove();
    track('download');
  }
  async function copyText(text: string, which: 'caption' | 'link') {
    try { await navigator.clipboard.writeText(text); copied = which; setTimeout(() => (copied = ''), 2000); if (which === 'caption') track('caption_copy'); } catch { error = t('error'); }
  }
  function again() { step = 'landing'; result = null; photo?.bitmap.close(); photo = null; tf = { ...IDENTITY }; }

  const link = $derived(c?.ctaUrl || (typeof location !== 'undefined' ? `${location.origin}/c/${code}` : ''));
  const missingRequired = (id: string) => touched && fields.find((f) => f.id === id)?.required && !(values[id] ?? '').trim();
  const stateMsg: Record<string, Key> = { scheduled: 'notStarted', paused: 'paused', ended: 'ended' };
</script>

<svelte:head><title>{c?.title ?? 'Campaign'}</title><meta name="robots" content="noindex" /></svelte:head>

<div class="page" lang={lang}>
  <header class="bar">
    <a class="org" href={c ? `/o/${c.orgSlug}` : '/'}>
      {#if c?.logoUrl}<img src={c.logoUrl} alt="" class="av" />{:else if c}<span class="av ph">{c.organisation.slice(0, 1)}</span>{/if}
      <strong>{c?.organisation ?? ''}</strong>
    </a>
  </header>

  <main>
    {#if missing}
      <div class="center"><h1>{t('notFound')}</h1><p class="muted">{t('notFoundHint')}</p></div>
    {:else if failed}
      <div class="center"><h1>{t('error')}</h1><p><button class="btn" onclick={() => location.reload()}>Reload</button></p></div>
    {:else if !c}
      <p class="center muted">…</p>
    {:else}
      {#if c.preview}<p class="preview" role="status">{t('preview')}</p>{/if}

      {#if c.state !== 'live'}
        <div class="center">
          <h1>{c.title}</h1>
          <p>{t(stateMsg[c.state] ?? 'paused')}</p>
          {#if c.state === 'scheduled'}<p><strong>{t('startsAt')}: {showIst(c.startsAt)}</strong></p>{/if}
          {#if c.state === 'ended' && c.thankYou}<p class="muted">{c.thankYou}</p>{/if}
        </div>
      {:else if c.templates.length === 0 || !tpl}
        <div class="center"><h1>{c.title}</h1><p class="muted">{t('noFrame')}</p></div>
      {:else if step === 'done' && result}
        <div class="done">
          <h1>{t('yourFrame')} 🎉</h1>
          <img src={result.url} alt={c.title} class="out" />
          <div class="actions">
            <button class="btn big" onclick={share}>{t('share')}</button>
            <button class="btn ghost big" onclick={download}>{t('download')}</button>
          </div>
          {#if caption}<button class="btn ghost block" onclick={() => copyText(caption, 'caption')}>{copied === 'caption' ? t('copied') : t('copyCaption')}</button>{/if}
          <section class="thanks">
            <h2>{t('thanks')}</h2>
            {#if c.thankYou}<p>{c.thankYou}</p>{/if}
            <button class="btn dark block" onclick={() => copyText(link, 'link')}>{copied === 'link' ? t('linkCopied') : t('invite')}</button>
            <button class="link" onclick={again}>{t('again')}</button>
          </section>
        </div>
      {:else}
        <div class="head">
          <h1>{c.title}</h1>
          {#if c.description}<p class="muted">{c.description}</p>{/if}
        </div>

        {#if c.templates.length > 1}
          <div class="strip" role="radiogroup" aria-label="Frames">
            {#each c.templates as tp}
              <button role="radio" aria-checked={tp.id === tplId} class:on={tp.id === tplId} onclick={() => { tplId = tp.id; tf = { ...IDENTITY }; }}><img src={tp.assetUrl} alt={tp.name} /></button>
            {/each}
          </div>
        {/if}

        <div class="tile" class:plain={step !== 'landing'}>
        <div class="stage" class:edit={step === 'edit'}>
          <canvas bind:this={canvas} aria-label={c.title}
            onpointerdown={step === 'edit' ? pdown : undefined} onpointermove={step === 'edit' ? pmove : undefined}
            onpointerup={pup} onpointercancel={pup} onwheel={step === 'edit' ? wheel : undefined}></canvas>
        </div>
        </div>

        {#if step === 'landing'}
          <p class="count">{t('people')}: <strong>{c.outputs.toLocaleString('en-IN')}</strong></p>
          <label class="btn big block pick">{t('add')}<input type="file" accept="image/*" onchange={onPick} hidden /></label>
          <p class="privacy">{t('privacy')}</p>

          {#if c.description}
            <section class="about"><h2>{t('about')}</h2><p>{c.description}</p></section>
          {/if}
          <section class="about">
            <h2>{t('shareLink')}</h2>
            <div class="row">
              <button class="sm" onclick={() => copyText(link, 'link')}>{copied === 'link' ? t('linkCopied') : t('copyLink')}</button>
              <a class="btn ghost sm" href={`https://wa.me/?text=${encodeURIComponent(`${c.title} ${location.origin}/c/${code}`)}`} target="_blank" rel="noopener">WhatsApp</a>
            </div>
          </section>
          {#if c.more?.length}
            <section class="about">
              <h2>{t('moreFrom')} {c.organisation}</h2>
              <div class="more">{#each c.more as m (m.code)}<CampaignCard c={m} />{/each}</div>
            </section>
          {/if}
        {:else}
          <p class="muted tip">{t('hint')}</p>
          <div class="tools" role="group" aria-label="Adjust photo">
            <button onclick={() => zoom(0.9)} aria-label={t('zoomOut')}>−</button>
            <button onclick={() => zoom(1.1)} aria-label={t('zoomIn')}>+</button>
            <button onclick={rotate} aria-label={t('rotate')}>⟳</button>
            <button onclick={() => nudge(-20, 0)} aria-label="{t('move')} ←">←</button>
            <button onclick={() => nudge(20, 0)} aria-label="{t('move')} →">→</button>
            <button onclick={() => nudge(0, -20)} aria-label="{t('move')} ↑">↑</button>
            <button onclick={() => nudge(0, 20)} aria-label="{t('move')} ↓">↓</button>
          </div>

          <form onsubmit={(e) => { e.preventDefault(); create(); }}>
            {#each fields as s (s.id)}
              <label class="field">{s.label}{s.required ? ' *' : ''}
                {#if s.inputType === 'dropdown'}
                  <select bind:value={values[s.id]} required={s.required}><option value="" disabled>{t('pick')}</option>{#each s.options as o}<option>{o}</option>{/each}</select>
                {:else}
                  <input bind:value={values[s.id]} maxlength={s.maxChars} required={s.required} autocomplete="name" enterkeyhint="done" />
                {/if}
                {#if missingRequired(s.id)}<span class="error">{t('required')}</span>{/if}
              </label>
            {/each}
            <Turnstile {siteKey} bind:token={botToken} reset={botReset} />
            {#if error}<p class="error" role="alert">{error}</p>{/if}
            <button class="btn big block" disabled={busy || (!!siteKey && !botToken)}>{busy ? t('creating') : t('create')}</button>
            <label class="link center-link">{t('change')}<input type="file" accept="image/*" onchange={onPick} hidden /></label>
          </form>
        {/if}
        {#if error && step === 'landing'}<p class="error" role="alert">{error}</p>{/if}
      {/if}
    {/if}
  </main>

  <footer><a href="/">{t('powered')}</a> · <span>{t('credit')} <strong>CV</strong></span></footer>
</div>

<style>
  .page { min-height: 100vh; display: flex; flex-direction: column; max-width: 520px; margin: 0 auto; }
  .bar { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; gap: 12px; }
  .org { display: flex; align-items: center; gap: 10px; min-width: 0; text-decoration: none; color: inherit; }
  .av { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; background: #fff; border: 1px solid var(--line); flex: none; }
  .av.ph { display: grid; place-items: center; background: var(--ink); color: #fff; font-weight: 700; border: 0; }
  .tile { background: #eaf3f1; border-radius: 22px; padding: 16px; margin-top: 8px; }
  .tile.plain { background: transparent; padding: 0; }
  .about { margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--line); }
  .about h2 { font-size: 1.1rem; }
  .more { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
  .org strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  main { flex: 1; padding: 0 16px 24px; }
  .center { text-align: center; padding: 56px 8px; }
  .head h1 { margin-bottom: 4px; font-size: 1.6rem; }
  .preview { background: var(--warn-bg); color: var(--warn); padding: 8px 12px; border-radius: 10px; font-weight: 600; font-size: .9rem; }
  .strip { display: flex; gap: 10px; overflow-x: auto; padding: 4px 0 12px; }
  .strip button { padding: 3px; width: 72px; height: 72px; flex: none; border: 2px solid var(--line); background: #fff; }
  .strip button.on { border-color: var(--coral); }
  .strip img { width: 100%; height: 100%; object-fit: contain; }
  .stage { border-radius: 14px; overflow: hidden; box-shadow: var(--shadow); background: #fff; line-height: 0; }
  canvas { width: 100%; height: auto; display: block; touch-action: none; }
  .stage.edit canvas { cursor: grab; }
  .count { text-align: center; color: var(--muted); margin: 14px 0; font-weight: 500; }
  .btn.big { min-height: 56px; font-size: 1.05rem; }
  .pick { cursor: pointer; }
  .privacy, .tip { text-align: center; font-size: .85rem; color: var(--muted); margin-top: 12px; }
  .tools { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin: 8px 0 16px; }
  .tools button { min-width: 48px; min-height: 48px; padding: 0; font-size: 1.2rem; }
  .field select, .field input { min-height: 52px; font-size: 1rem; }
  .center-link { display: block; text-align: center; margin-top: 16px; cursor: pointer; }
  .link { background: none; border: 0; color: var(--coral-600); text-decoration: underline; cursor: pointer; padding: 8px; }
  .link:hover:not(:disabled) { background: none; }
  .done h1 { font-size: 1.5rem; text-align: center; }
  .out { width: 100%; border-radius: 14px; box-shadow: var(--shadow); display: block; }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px 0 12px; }
  .thanks { text-align: center; margin-top: 28px; padding-top: 24px; border-top: 1px solid var(--line); }
  .thanks .btn { margin: 8px 0 4px; }
  footer { text-align: center; padding: 16px; font-size: .8rem; }
  footer a { color: var(--muted); }
  footer strong { color: var(--coral); letter-spacing: .05em; }
</style>
