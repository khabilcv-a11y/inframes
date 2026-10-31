<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import type { Rect, SlotStyle } from '@inframe/shared';
  import { api } from '$lib/api';
  import { showIst } from '$lib/time';
  import { dict, type Key, type Lang } from '$lib/i18n';
  import Turnstile from '$lib/Turnstile.svelte';
  import CampaignCard, { type Card } from '$lib/CampaignCard.svelte';
  import LogoPuzzle from '$lib/LogoPuzzle.svelte';
  import { decodePhoto, ensureFonts, loadImage, render, IDENTITY, type RenderSlot, type Transform } from '$lib/compositor';

  type Slot = { id: string; label: string; inputType: 'text' | 'dropdown' | 'fixed'; options: string[]; fixedValue: string | null; required: boolean; box: Rect; style: SlotStyle; maxChars: number };
  type Tpl = { id: string; name: string; width: number; height: number; assetUrl: string; photoWindows: Rect[]; slots: Slot[] };
  type Pic = { bitmap: ImageBitmap; w: number; h: number; tf: Transform; file: File };
  type C = { title: string; description: string | null; language: Lang; organisation: string; orgSlug: string; logoUrl: string | null; more: Card[]; state: string; preview: boolean; startsAt: string; caption: string | null; hashtags: string | null; thankYou: string | null; ctaUrl: string | null; outputs: number; saveMode: string; templates: Tpl[] };

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
  // One photo per photo area (a normal frame has one, a collage several). Plain array + a counter to refresh the screen.
  let pics: (Pic | null)[] = [];
  let ver = $state(0);
  let sel = $state(0);
  let frameImgs: Record<string, HTMLImageElement> = {};
  let raf = 0;
  let visitor = '';
  let siteKey = $state<string | null>(null);
  let botToken = $state('');
  let botReset = $state(0);
  let consent = $state(false);
  let drive = $state<'' | 'saving' | 'saved' | 'failed'>('');
  const savesRaw = $derived(c?.saveMode === 'raw' || c?.saveMode === 'both');
  const savesFramed = $derived(c?.saveMode === 'framed' || c?.saveMode === 'both');

  const t = (k: Key) => dict[lang][k];
  const tpl = $derived(c?.templates.find((x) => x.id === tplId) ?? null);
  const fields = $derived(tpl?.slots.filter((s) => s.inputType !== 'fixed') ?? []);
  const nWin = $derived(tpl?.photoWindows.length ?? 1);
  const filled = $derived.by(() => { void ver; return Array.from({ length: nWin }, (_, i) => !!pics[i]); });
  const allFilled = $derived(filled.every(Boolean));

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
  const photosFor = (tp: Tpl) => tp.photoWindows.map((_, i) => (pics[i] ? { source: pics[i]!.bitmap, w: pics[i]!.w, h: pics[i]!.h, tf: pics[i]!.tf } : null));
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
      render(canvas.getContext('2d')!, { width: tpl.width, height: tpl.height, frame: img, windows: tpl.photoWindows, photos: photosFor(tpl), highlight: step === 'edit' ? sel : null, slots: slotsFor(tpl), values: v }, k);
    });
  }
  $effect(() => { JSON.stringify(values); tplId; step; sel; ver; draw(); });

  // ---- photo ----
  /** `replace` swaps the selected area's photo; otherwise the chosen photos fill the empty areas in order. */
  async function onPick(e: Event, replace = false) {
    const input = e.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length || !tpl) return;
    error = '';
    try {
      const targets = replace ? [sel] : Array.from({ length: nWin }, (_, i) => i).filter((i) => !pics[i]);
      if (!targets.length) targets.push(sel);
      for (let j = 0; j < Math.min(files.length, targets.length); j++) {
        const d = await decodePhoto(files[j]);
        pics[targets[j]]?.bitmap.close();
        pics[targets[j]] = { ...d, tf: { ...IDENTITY }, file: files[j] };
        track('pick', { type: 'photo' });
      }
      const nextEmpty = Array.from({ length: nWin }, (_, i) => i).find((i) => !pics[i]);
      sel = nextEmpty ?? (replace ? sel : 0);
      ver++;
      step = 'edit';
      await tick();
      draw();
    } catch { error = t('error'); }
  }

  // ---- gestures: one finger moves, two fingers zoom and rotate, wheel zooms ----
  const pts = new Map<number, { x: number; y: number }>();
  let last: { d: number; a: number } | null = null;
  const dist = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x) }; };
  const clamp = (s: number) => Math.min(8, Math.max(1, s));
  const cur = () => pics[sel] ?? null;
  function pdown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (pts.size === 0 && tpl && canvas && nWin > 1) {
      // touching a photo area selects it, so each photo can be adjusted on its own
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * tpl.width, y = ((e.clientY - r.top) / r.height) * tpl.height;
      const hit = tpl.photoWindows.findIndex((w) => x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h);
      if (hit >= 0 && hit !== sel) { sel = hit; }
    }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) last = dist();
  }
  function pmove(e: PointerEvent) {
    const p = pts.get(e.pointerId), pic = cur();
    if (!p || !pic || !tpl || !canvas) return;
    const k = tpl.width / canvas.getBoundingClientRect().width;
    if (pts.size === 1) { pic.tf.x += (e.clientX - p.x) * k; pic.tf.y += (e.clientY - p.y) * k; }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && last) { const n = dist(); pic.tf.scale = clamp(pic.tf.scale * (n.d / last.d)); pic.tf.rot += n.a - last.a; last = n; }
    draw();
  }
  function pup(e: PointerEvent) { pts.delete(e.pointerId); last = null; }
  function wheel(e: WheelEvent) { const pic = cur(); if (!pic) return; e.preventDefault(); pic.tf.scale = clamp(pic.tf.scale * (e.deltaY < 0 ? 1.06 : 0.94)); draw(); }
  const zoom = (f: number) => { const pic = cur(); if (pic) { pic.tf.scale = clamp(pic.tf.scale * f); draw(); } };
  const rotate = () => { const pic = cur(); if (pic) { pic.tf.rot += Math.PI / 12; draw(); } };
  const nudge = (dx: number, dy: number) => { const pic = cur(); if (pic) { pic.tf.x += dx; pic.tf.y += dy; draw(); } };

  // ---- create ----
  function validate(): boolean {
    touched = true;
    return fields.every((s) => !s.required || (values[s.id] ?? '').trim());
  }
  async function create() {
    if (!tpl || !validate()) return;
    if (!allFilled) { error = t('needAll'); return; }
    if (savesRaw && !consent) { error = t('needConsent'); return; }
    if (siteKey && !botToken) { error = t('error'); return; }
    busy = true; error = '';
    try {
      const img = frameImgs[tpl.id];
      const v = valuesFor(tpl);
      await ensureFonts(slotsFor(tpl), v);
      const off = document.createElement('canvas');
      off.width = tpl.width; off.height = tpl.height;
      render(off.getContext('2d')!, { width: tpl.width, height: tpl.height, frame: img, windows: tpl.photoWindows, photos: photosFor(tpl), slots: slotsFor(tpl), values: v }, 1);
      const blob = await new Promise<Blob>((res, rej) => off.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.92));
      const slotValues = Object.fromEntries(tpl.slots.filter((s) => s.inputType !== 'fixed').map((s) => [s.id, (values[s.id] ?? '').trim()]));
      const r = await api<{ id?: string; serial?: number; error?: string }>(`/c/${code}/outputs${q}`, { method: 'POST', body: JSON.stringify({ templateId: tpl.id, visitorId: visitor, slotValues, turnstileToken: botToken || undefined }) });
      botReset++;
      if (!r.ok) {
        if (r.data.error === 'bad_template') await refresh(); // the organiser just changed the frame
        error = r.data.error === 'rate_limited' ? t('tooMany') : t('error');
        return;
      }
      try { localStorage.setItem(`inframe_vals_${code}`, JSON.stringify(values)); } catch { /* ignore */ }
      result = { blob, url: URL.createObjectURL(blob), serial: r.data.serial ?? 0 };
      if (r.data.id && r.data.id !== 'preview') void saveToDrive(r.data.id, blob);
      if (c) c.outputs += preview ? 0 : 1;
      track('create');
      step = 'done';
      window.scrollTo({ top: 0 });
    } catch { error = t('error'); track('error', { step: 'create' }); } finally { busy = false; }
  }

  // ---- save a copy to the organiser's Drive (in the background; the participant never waits for it) ----
  async function putToDrive(outputId: string, kind: 'raw' | 'framed', file: Blob, mime: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const slot = await api<{ uploadUrl?: string }>(`/c/${code}/outputs/${outputId}/upload`, { method: 'POST', body: JSON.stringify({ visitorId: visitor, kind, mime, size: file.size }) });
        if (!slot.ok || !slot.data.uploadUrl) return false; // not allowed or Drive unavailable: no point retrying
        const up = await fetch(slot.data.uploadUrl, { method: 'PUT', headers: { 'content-type': mime }, body: file });
        const { id } = (await up.json()) as { id?: string };
        if (!up.ok || !id) throw new Error('put');
        const done = await api(`/c/${code}/outputs/${outputId}/uploaded`, { method: 'POST', body: JSON.stringify({ visitorId: visitor, kind, fileId: id }) });
        return done.ok;
      } catch { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); }
    }
    return false;
  }
  async function saveToDrive(outputId: string, framed: Blob) {
    if (!c || c.saveMode === 'off') return;
    drive = 'saving';
    const jobs: Promise<boolean>[] = [];
    if (savesRaw) for (const p of pics.slice(0, nWin)) if (p) jobs.push(putToDrive(outputId, 'raw', p.file, /^image\/[a-z0-9.+-]+$/i.test(p.file.type) ? p.file.type : 'image/jpeg'));
    if (savesFramed) jobs.push(putToDrive(outputId, 'framed', framed, 'image/jpeg'));
    const res = await Promise.all(jobs);
    drive = res.every(Boolean) ? 'saved' : 'failed';
    if (drive === 'failed') track('error', { step: 'drive' });
  }

  // ---- share ----
  const fileName = () => `${code}-${result?.serial || 'frame'}.jpg`;
  /** The campaign's own link, tagged so you can see in Results how many visits came from shares. */
  const shareLink = $derived(typeof location !== 'undefined' ? `${location.origin}/c/${code}?r=share` : '');
  /** What travels with the picture: caption, hashtags and the link that brings the next person in. */
  const caption = $derived([c?.caption, c?.hashtags, shareLink].filter(Boolean).join('\n\n'));
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
  function again() { step = 'landing'; result = null; drive = ''; consent = false; for (const p of pics) p?.bitmap.close(); pics = []; sel = 0; ver++; }

  const link = $derived(typeof location !== 'undefined' ? `${location.origin}/c/${code}` : '');
  /** The organiser's external link (social page, website, group…) gets a button named after where it goes. */
  const cta = $derived.by((): { url: string; label: Key } | null => {
    const u = c?.ctaUrl;
    if (!u) return null;
    const host = (() => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } })();
    const rules: [RegExp, Key][] = [[/instagram\.com$|instagr\.am$/, 'ctaInstagram'], [/facebook\.com$|fb\.com$|fb\.me$/, 'ctaFacebook'], [/youtube\.com$|youtu\.be$/, 'ctaYoutube'], [/(^|\.)wa\.me$|whatsapp\.com$/, 'ctaWhatsapp'], [/(^|\.)t\.me$|telegram\.(me|org)$/, 'ctaTelegram'], [/(^|\.)x\.com$|twitter\.com$/, 'ctaX']];
    return { url: u, label: rules.find(([re]) => re.test(host))?.[1] ?? 'ctaWebsite' };
  });
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
          {#if drive}<p class="privacy" role="status" style="margin:0 0 12px">{drive === 'saving' ? t('savingDrive') : drive === 'saved' ? t('savedDrive') : t('saveFailed')}</p>{/if}
          <section class="thanks">
            <h2>{t('thanks')}</h2>
            {#if c.thankYou}<p>{c.thankYou}</p>{/if}
            <button class="btn dark block" onclick={() => copyText(caption, 'caption')}>{copied === 'caption' ? t('inviteCopied') : t('invite')}</button>
            {#if cta}<a class="btn ghost block" href={cta.url} target="_blank" rel="noopener" onclick={() => track('cta_click')}>{t(cta.label)} ↗</a>{/if}
            <button class="link" onclick={again}>{t('again')}</button>
          </section>
        </div>
      {:else}
        {#if step === 'landing'}<LogoPuzzle text={c.title} compact />{/if}
        <div class="head" class:sr={step === 'landing'}>
          <h1>{c.title}</h1>
          {#if c.description}<p class="muted">{c.description}</p>{/if}
        </div>

        {#if c.templates.length > 1}
          <div class="strip" role="radiogroup" aria-label="Frames">
            {#each c.templates as tp}
              <button role="radio" aria-checked={tp.id === tplId} class:on={tp.id === tplId} onclick={() => { tplId = tp.id; sel = 0; }}><img src={tp.assetUrl} alt={tp.name} /></button>
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
          <label class="btn big block pick">{nWin > 1 ? t('addPhotos') : t('add')}<input type="file" accept="image/*" multiple={nWin > 1} onchange={(e) => onPick(e)} hidden /></label>
          {#if nWin > 1}<p class="privacy" style="margin-top:8px">{t('collageHint')} {nWin}</p>{/if}
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
          {#if nWin > 1}
            <div class="wins" role="group" aria-label="Photos">
              {#each filled as ok, i}
                <button class:on={i === sel} class:ok onclick={() => (sel = i)}>{t('photoN')} {i + 1}{ok ? ' ✓' : ''}</button>
              {/each}
            </div>
          {/if}
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
            {#if savesRaw}
              <label class="consent"><input type="checkbox" bind:checked={consent} /> <span>{t('consentRaw')}</span></label>
            {:else if savesFramed}
              <p class="privacy" style="margin:0 0 12px">{t('noticeFramed')}</p>
            {/if}
            <Turnstile {siteKey} bind:token={botToken} reset={botReset} />
            {#if error}<p class="error" role="alert">{error}</p>{/if}
            <button class="btn big block" disabled={busy || (!!siteKey && !botToken)}>{busy ? t('creating') : t('create')}</button>
            <label class="link center-link">{t('change')}<input type="file" accept="image/*" onchange={(e) => onPick(e, true)} hidden /></label>
            {#if nWin > 1 && !allFilled}<label class="link center-link">{t('addMore')}<input type="file" accept="image/*" multiple onchange={(e) => onPick(e)} hidden /></label>{/if}
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
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
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
  .consent { display: flex; gap: 10px; align-items: flex-start; margin: 4px 0 14px; font-size: .92rem; cursor: pointer; }
  .consent input { margin: 3px 0 0; width: 22px; height: 22px; min-height: 0; flex: none; }
  .wins { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin: 12px 0 0; }
  .wins button { min-height: 40px; }
  .wins button.on { background: var(--ink); color: #fff; border-color: var(--ink); }
  .wins button.ok:not(.on) { border-color: var(--ok); color: var(--ok); }
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
