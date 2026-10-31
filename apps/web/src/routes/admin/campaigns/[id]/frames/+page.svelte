<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { FONTS, MAX_ASSET_BYTES, matchOutputSize, type Rect, type SlotStyle } from '@inframe/shared';
  import { api } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import { detectWhiteBoxes, detectWindows, ensureFonts, loadImage, render, type RenderSlot } from '$lib/compositor';

  type Slot = { key: string; label: string; inputType: 'text' | 'dropdown' | 'fixed'; options: string[]; fixedValue: string | null; required: boolean; box: Rect; style: SlotStyle; maxChars: number };
  type Tpl = { id: string; name: string; width: number; height: number; assetUrl: string; photoWindows: Rect[]; slots: (Omit<Slot, 'key'> & { id: string })[] };

  const id = page.params.id!;
  const canEdit = $derived(session.user?.role !== 'viewer');
  const STRESS = 'Muhammed Abdul Rahiman Kunhikannan';
  const defaultStyle = (): SlotStyle => ({ font: 'Inter', maxSize: 64, minSize: 24, lines: 1, color: '#FFFFFF', weight: 700, tracking: 0, align: 'center', valign: 'middle', case: 'as_typed' });

  let tpls = $state<Tpl[]>([]);
  let selId = $state<string | null>(null);
  let slots = $state<Slot[]>([]);
  let selKey = $state<string | null>(null);
  let stress = $state(false);
  let msg = $state('');
  let err = $state('');
  let busy = $state(false);
  let dirty = $state(false);
  let canvas = $state<HTMLCanvasElement>();
  let frameImg: HTMLImageElement | null = null;
  let draw = $state<{ x: number; y: number; x2: number; y2: number } | null>(null);
  let act: { mode: 'move' | 'resize'; key: string; sx: number; sy: number; box: Rect } | null = null;
  let optionsText = $state('');
  let n = 0;

  const sel = $derived(tpls.find((t) => t.id === selId) ?? null);
  const selSlot = $derived(slots.find((s) => s.key === selKey) ?? null);

  async function load(keep?: string) {
    const r = await api<{ templates: Tpl[] }>(`/admin/campaigns/${id}/templates`);
    if (!r.ok) return;
    tpls = r.data.templates;
    const target = keep ?? selId ?? tpls[0]?.id ?? null;
    if (target) await select(target); else { selId = null; slots = []; }
  }
  onMount(() => load());

  async function select(tid: string) {
    selId = tid;
    const t = tpls.find((x) => x.id === tid)!;
    slots = t.slots.map((s) => ({ ...s, key: s.id, fixedValue: s.fixedValue ?? null }));
    selKey = slots[0]?.key ?? null;
    dirty = false;
    frameImg = await loadImage(t.assetUrl);
    await tick();
    redraw();
  }

  $effect(() => { selSlot; optionsText = selSlot?.options.join('\n') ?? ''; });

  function sample(s: Slot): string {
    if (s.inputType === 'fixed') return s.fixedValue ?? '';
    if (s.inputType === 'dropdown') return stress ? [...s.options].sort((a, b) => b.length - a.length)[0] ?? STRESS : s.options[0] ?? s.label;
    return stress ? STRESS : s.label.toLowerCase().includes('name') ? 'Asha Menon' : s.label;
  }

  async function redraw() {
    if (!canvas || !sel || !frameImg) return;
    const rs: RenderSlot[] = slots.map((s) => ({ id: s.key, box: s.box, style: s.style }));
    const values = Object.fromEntries(slots.map((s) => [s.key, sample(s)]));
    await ensureFonts(rs, values);
    const k = 540 / sel.width;
    canvas.width = Math.round(sel.width * k);
    canvas.height = Math.round(sel.height * k);
    render(canvas.getContext('2d')!, { width: sel.width, height: sel.height, frame: frameImg, windows: sel.photoWindows, photos: [], slots: rs, values }, k);
  }
  $effect(() => { JSON.stringify(slots); stress; sel; redraw(); });

  // ---- Upload ----
  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    err = ''; msg = ''; busy = true;
    try {
      if (!['image/png', 'image/webp'].includes(file.type)) throw new Error('Use a PNG with a transparent photo area.');
      const img = await loadImage(file);
      const size = matchOutputSize(img.width, img.height);
      if (!size) throw new Error(`Frame shape must be square (1:1), portrait (4:5) or story (9:16); yours is ${img.width}×${img.height}. Any resolution is fine, such as 3000×3000.`);
      if (img.width < size.width * 0.5) throw new Error(`Frame is too small (${img.width}×${img.height}). Use at least ${Math.round(size.width / 2)} px wide so it stays sharp.`);

      // Resize to the standard output size (high-resolution designs are scaled down; the photo area is found after scaling).
      const c = document.createElement('canvas'); c.width = size.width; c.height = size.height;
      const cx = c.getContext('2d')!;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(img, 0, 0, size.width, size.height);
      const wins = detectWindows(c);
      if (!wins.length) throw new Error('This frame has no transparent area, so there is nowhere for the photo to show. Cut a transparent window in your design and export again as PNG.');
      let blob: Blob | null = null;
      for (const [type, q] of [['image/webp', 0.92], ['image/webp', 0.8], ['image/webp', 0.65]] as const) {
        blob = await new Promise<Blob | null>((res) => c.toBlob(res, type, q));
        if (blob && blob.type === type && blob.size <= MAX_ASSET_BYTES) break;
        blob = null;
      }
      if (!blob) throw new Error('This frame is too large even after compressing. Simplify gradients or export a smaller PNG.');

      const f = new FormData();
      f.set('file', new File([blob], 'frame.webp', { type: blob.type }));
      f.set('name', file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Frame');
      f.set('width', String(size.width)); f.set('height', String(size.height));
      f.set('photoWindows', JSON.stringify(wins));
      const res = await fetch(`/api/admin/campaigns/${id}/templates`, { method: 'POST', body: f, credentials: 'same-origin' });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) throw new Error(data.error === 'file_too_large' ? 'File is too large.' : 'Upload failed. Try again.');
      msg = wins.length > 1 ? `Frame added with ${wins.length} photo areas (a collage). Now add the title boxes.` : 'Frame added. Now add the title boxes: click Detect white boxes, or drag on the preview.';
      await load(data.id);
    } catch (e) {
      err = e instanceof Error ? e.message : 'Could not read that image.';
    } finally { busy = false; }
  }

  // ---- Boxes ----
  const addSlot = (kind: 'name' | 'college') => {
    if (!sel) return;
    const w = sel.width, h = sel.height;
    const s: Slot = kind === 'name'
      ? { key: `n${++n}`, label: 'Your name', inputType: 'text', options: [], fixedValue: null, required: true, box: { x: 60, y: h - 230, w: w - 120, h: 100 }, style: { ...defaultStyle(), case: 'title' }, maxChars: 40 }
      : { key: `n${++n}`, label: 'Your college', inputType: 'dropdown', options: [], fixedValue: null, required: true, box: { x: 60, y: h - 120, w: w - 120, h: 76 }, style: { ...defaultStyle(), maxSize: 44, minSize: 20, weight: 500 }, maxChars: 80 };
    slots = [...slots, s]; selKey = s.key; dirty = true;
  };
  const removeSlot = () => { slots = slots.filter((s) => s.key !== selKey); selKey = slots[0]?.key ?? null; dirty = true; };
  const touch = () => { dirty = true; };
  const setOptions = () => { if (selSlot) { selSlot.options = optionsText.split('\n').map((x) => x.trim()).filter(Boolean); dirty = true; } };

  function pt(e: PointerEvent, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, Math.min(sel!.width, ((e.clientX - r.left) / r.width) * sel!.width)), y: Math.max(0, Math.min(sel!.height, ((e.clientY - r.top) / r.height) * sel!.height)) };
  }
  function down(e: PointerEvent) {
    if (!canEdit || !sel) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const p = pt(e, el);
    draw = { x: p.x, y: p.y, x2: p.x, y2: p.y };
  }
  function boxDown(e: PointerEvent, s: Slot, mode: 'move' | 'resize') {
    e.stopPropagation();
    selKey = s.key;
    if (!canEdit) return;
    const overlay = (e.currentTarget as HTMLElement).closest('.overlay') as HTMLElement;
    overlay.setPointerCapture(e.pointerId);
    const p = pt(e as unknown as PointerEvent, overlay);
    act = { mode, key: s.key, sx: p.x, sy: p.y, box: { ...s.box } };
  }
  function move(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    if (act && sel) {
      const s = slots.find((x) => x.key === act!.key);
      if (!s) return;
      const p = pt(e, el);
      const dx = p.x - act.sx, dy = p.y - act.sy;
      if (act.mode === 'move') {
        s.box.x = Math.round(Math.max(0, Math.min(sel.width - act.box.w, act.box.x + dx)));
        s.box.y = Math.round(Math.max(0, Math.min(sel.height - act.box.h, act.box.y + dy)));
      } else {
        s.box.w = Math.round(Math.max(40, Math.min(sel.width - act.box.x, act.box.w + dx)));
        s.box.h = Math.round(Math.max(24, Math.min(sel.height - act.box.y, act.box.h + dy)));
      }
      dirty = true;
      return;
    }
    if (draw) { const p = pt(e, el); draw = { ...draw, x2: p.x, y2: p.y }; }
  }
  function up() {
    if (act) { act = null; return; }
    if (!draw || !sel) return;
    const x = Math.min(draw.x, draw.x2), y = Math.min(draw.y, draw.y2), w = Math.abs(draw.x2 - draw.x), h = Math.abs(draw.y2 - draw.y);
    draw = null;
    if (w < 40 || h < 24) return;
    const s: Slot = { key: `n${++n}`, label: 'Text', inputType: 'text', options: [], fixedValue: null, required: true, box: { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }, style: defaultStyle(), maxChars: 40 };
    slots = [...slots, s]; selKey = s.key; dirty = true;
  }

  const DARK = '#16161A';
  let found = $state<string>('');
  /** One click: find the white boxes the designer left for text and make a title box for each. */
  function detectBoxes() {
    if (!sel || !frameImg) return;
    const boxes = detectWhiteBoxes(frameImg);
    if (!boxes.length) { found = 'No white boxes found. Draw them by dragging on the preview.'; return; }
    const names = ['Your college', 'Your village', 'Your name'];
    const added = boxes.map((b, i): Slot => ({
      key: `n${++n}`, label: names[i] ?? `Text ${i + 1}`, inputType: 'text', options: [], fixedValue: null, required: true, box: b,
      style: { ...defaultStyle(), color: DARK, maxSize: Math.max(24, Math.min(80, Math.round(b.h * 0.6))), minSize: 16, weight: 600 }, maxChars: 60
    }));
    slots = [...slots, ...added]; selKey = added[0].key; dirty = true;
    found = `Found ${boxes.length} white box${boxes.length > 1 ? 'es' : ''}. Click each one to name it and choose Free text or Dropdown.`;
  }
  const addBox = () => {
    if (!sel) return;
    const w = Math.round(sel.width * 0.6), h = 90;
    const s: Slot = { key: `n${++n}`, label: 'Text', inputType: 'text', options: [], fixedValue: null, required: true, box: { x: Math.round((sel.width - w) / 2), y: Math.round(sel.height * 0.5), w, h }, style: defaultStyle(), maxChars: 40 };
    slots = [...slots, s]; selKey = s.key; dirty = true;
  };

  async function saveSlots() {
    if (!sel) return;
    err = ''; msg = ''; busy = true;
    const payload = slots.map(({ key, ...s }) => ({ label: s.label, inputType: s.inputType, options: s.inputType === 'dropdown' ? s.options : undefined, fixedValue: s.inputType === 'fixed' ? s.fixedValue ?? '' : undefined, required: s.required, box: s.box, style: s.style, maxChars: s.maxChars }));
    const r = await api<{ error?: string }>(`/admin/templates/${sel.id}/slots`, { method: 'PUT', body: JSON.stringify({ slots: payload }) });
    busy = false;
    if (!r.ok) { err = r.data.error === 'dropdown_needs_options' ? 'A dropdown needs at least one option.' : r.data.error === 'box_outside_frame' ? 'A box goes outside the frame.' : 'Could not save. Check the box settings.'; return; }
    msg = 'Saved.'; dirty = false;
    await load(sel.id);
  }

  async function removeTemplate() {
    if (!sel || !confirm(`Delete frame "${sel.name}"?\n\nIt disappears from the campaign. Anyone who already made a picture with it keeps their result, and your numbers and CSV stay the same.`)) return;
    const r = await api<{ archived?: boolean }>(`/admin/templates/${sel.id}`, { method: 'DELETE' });
    if (!r.ok) { err = 'Could not delete. Try again.'; return; }
    err = ''; msg = r.data.archived ? 'Frame removed. Earlier results are kept.' : 'Frame deleted.';
    selId = null;
    await load();
  }

  async function saveName() { if (sel) await api(`/admin/templates/${sel.id}`, { method: 'PATCH', body: JSON.stringify({ name: sel.name }) }); }
  async function saveWindow() {
    if (!sel) return;
    const r = await api(`/admin/templates/${sel.id}`, { method: 'PATCH', body: JSON.stringify({ photoWindows: sel.photoWindows }) });
    if (!r.ok) err = 'Photo areas must stay inside the frame.'; else { msg = 'Photo areas saved.'; err = ''; }
  }
  const addWindow = () => { if (sel && sel.photoWindows.length < 6) { sel.photoWindows = [...sel.photoWindows, { x: 60, y: 60, w: Math.round(sel.width / 3), h: Math.round(sel.width / 3) }]; } };
  const removeWindow = (i: number) => { if (sel && sel.photoWindows.length > 1) sel.photoWindows = sel.photoWindows.filter((_, j) => j !== i); };
  const pct = (b: Rect) => sel ? `left:${(b.x / sel.width) * 100}%;top:${(b.y / sel.height) * 100}%;width:${(b.w / sel.width) * 100}%;height:${(b.h / sel.height) * 100}%` : '';
</script>

<svelte:window onbeforeunload={(e) => { if (dirty) e.preventDefault(); }} />

{#if canEdit}
  <section class="card up">
    <div>
      <h2 style="margin-bottom:4px">Frames</h2>
      <p class="muted" style="margin:0">PNG with a transparent area where the photo will show. Square (1:1), portrait (4:5) or story (9:16), at any resolution: we resize it and find the photo area automatically.</p>
    </div>
    <label class="btn" class:disabled={busy}>
      {busy ? 'Working…' : '+ Upload frame'}
      <input type="file" accept="image/png,image/webp" onchange={onFile} disabled={busy} hidden />
    </label>
  </section>
{/if}

{#if err}<p class="error" role="alert" style="margin-top:12px">{err}</p>{/if}
{#if msg}<p style="margin-top:12px; color:var(--ok); font-weight:600" role="status">{msg}</p>{/if}

{#if tpls.length === 0}
  <div class="card empty" style="margin-top:16px">
    <p><strong>No frame yet.</strong></p>
    <p>Design your frame in Canva or Photoshop, export it as a PNG with a transparent photo area, then upload it here.</p>
  </div>
{:else if sel}
  {#if tpls.length > 1}
    <div class="row" style="margin:16px 0">
      {#each tpls as t}<button class="sm chip" class:on={t.id === selId} onclick={() => select(t.id)}>{t.name}</button>{/each}
    </div>
  {/if}

  <div class="editor">
    <div class="stage">
      <div class="canvaswrap">
        <canvas bind:this={canvas} aria-label="Frame preview"></canvas>
        <div class="overlay" role="presentation" onpointerdown={down} onpointermove={move} onpointerup={up}>
          {#each slots as s (s.key)}
            <div class="box" class:on={s.key === selKey} style={pct(s.box)} role="button" tabindex="0" aria-label={`Box: ${s.label}`}
              onpointerdown={(e) => boxDown(e, s, 'move')} onkeydown={(e) => { if (e.key === 'Enter') selKey = s.key; }}>
              <span>{s.label}</span>
              {#if s.key === selKey && canEdit}<i class="handle" onpointerdown={(e) => boxDown(e, s, 'resize')}></i>{/if}
            </div>
          {/each}
          {#if draw}<div class="box ghost" style={pct({ x: Math.min(draw.x, draw.x2), y: Math.min(draw.y, draw.y2), w: Math.abs(draw.x2 - draw.x), h: Math.abs(draw.y2 - draw.y) })}></div>{/if}
        </div>
      </div>
      <p class="muted" style="margin:8px 0 0"><small>{canEdit ? 'Drag on an empty area to draw a box. Drag a box to move it; drag its corner dot to resize.' : 'View only.'}</small></p>
    </div>

    <div class="panel">
      {#if canEdit}
        <div class="card">
          <div class="row">
            <button class="sm btn" onclick={detectBoxes}>✨ Detect white boxes</button>
            <button class="sm" onclick={addBox}>+ Add box</button>
            <button class="sm" onclick={() => addSlot('name')}>+ Name</button>
            <button class="sm" onclick={() => addSlot('college')}>+ College dropdown</button>
          </div>
          {#if found}<p class="muted" style="margin:10px 0 0"><small>{found}</small></p>{/if}
          <div class="row" style="margin-top:10px">
            <label class="sw"><input type="checkbox" bind:checked={stress} /> Test with a long name</label>
          </div>
        </div>
      {/if}

      {#if selSlot && canEdit}
        <div class="card form">
          <h3>Box settings</h3>
          <label class="field">Label shown to the participant <input bind:value={selSlot.label} oninput={touch} /></label>
          <div class="two">
            <label class="field">Type
              <select bind:value={selSlot.inputType} onchange={touch}><option value="text">Free text</option><option value="dropdown">Dropdown</option><option value="fixed">Fixed text</option></select>
            </label>
            <label class="field">Required <select value={selSlot.required ? 'y' : 'n'} onchange={(e) => { selSlot!.required = e.currentTarget.value === 'y'; touch(); }}><option value="y">Yes</option><option value="n">No</option></select></label>
          </div>
          {#if selSlot.inputType === 'dropdown'}
            <label class="field">Options <span class="hint">One per line. You can paste a column from Excel.</span>
              <textarea rows="6" bind:value={optionsText} oninput={setOptions}></textarea>
            </label>
            <p class="muted"><small>{selSlot.options.length} options</small></p>
          {:else if selSlot.inputType === 'fixed'}
            <label class="field">Text <input bind:value={selSlot.fixedValue} oninput={touch} /></label>
          {:else}
            <label class="field">Character limit <input type="number" min="1" max="120" bind:value={selSlot.maxChars} oninput={touch} /></label>
          {/if}
          <h3 style="margin-top:8px">Look</h3>
          <div class="two">
            <label class="field">Font <select bind:value={selSlot.style.font} onchange={touch}>{#each FONTS as f}<option>{f}</option>{/each}</select></label>
            <label class="field">Weight <select bind:value={selSlot.style.weight} onchange={() => { selSlot!.style.weight = Number(selSlot!.style.weight) as 400; touch(); }}><option value={400}>Regular</option><option value={500}>Medium</option><option value={600}>Semibold</option><option value={700}>Bold</option></select></label>
            <label class="field">Largest size <input type="number" min="8" max="300" bind:value={selSlot.style.maxSize} oninput={touch} /></label>
            <label class="field">Smallest size <input type="number" min="6" max="300" bind:value={selSlot.style.minSize} oninput={touch} /></label>
            <label class="field">Colour <input type="color" bind:value={selSlot.style.color} oninput={touch} style="padding:2px; height:44px; width:100%" /></label>
            <label class="field">Lines <select value={selSlot.style.lines} onchange={(e) => { selSlot!.style.lines = Number(e.currentTarget.value) as 1 | 2; touch(); }}><option value={1}>One</option><option value={2}>Up to two</option></select></label>
            <label class="field">Align <select bind:value={selSlot.style.align} onchange={touch}><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></label>
            <label class="field">Vertical <select bind:value={selSlot.style.valign} onchange={touch}><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></label>
            <label class="field">Letters <select bind:value={selSlot.style.case} onchange={touch}><option value="as_typed">As typed</option><option value="title">Title Case</option><option value="upper">UPPER CASE</option></select></label>
            <label class="field">Spacing <input type="number" step="0.5" min="-5" max="20" bind:value={selSlot.style.tracking} oninput={touch} /></label>
          </div>
          <details open>
            <summary>Position and size</summary>
            <p class="muted" style="margin:0 0 8px"><small>Drag the box on the preview, or use the sliders. You can also type a value.</small></p>
            {#each [
              { k: 'x', label: 'Left', min: 0, max: Math.max(0, sel.width - selSlot.box.w) },
              { k: 'y', label: 'Top', min: 0, max: Math.max(0, sel.height - selSlot.box.h) },
              { k: 'w', label: 'Width', min: 40, max: Math.max(40, sel.width - selSlot.box.x) },
              { k: 'h', label: 'Height', min: 24, max: Math.max(24, sel.height - selSlot.box.y) }
            ] as f (f.k)}
              <div class="sl">
                <span>{f.label}</span>
                <input type="range" min={f.min} max={f.max} step="1" bind:value={selSlot.box[f.k as 'x']} oninput={touch} aria-label={f.label} />
                <input class="num" type="number" min={f.min} max={f.max} bind:value={selSlot.box[f.k as 'x']} oninput={touch} aria-label={`${f.label} value`} />
              </div>
            {/each}
          </details>
          <button class="btn danger sm" onclick={removeSlot}>Delete this box</button>
        </div>
      {/if}

      {#if canEdit}
        <div class="card">
          <div class="row">
            <button class="btn" onclick={saveSlots} disabled={busy || !dirty}>Save boxes</button>
            {#if dirty}<small class="muted">Unsaved changes</small>{/if}
          </div>
          <details style="margin-top:16px">
            <summary>Frame settings</summary>
            <label class="field" style="margin-top:12px">Frame name <input bind:value={sel.name} onchange={saveName} /></label>
            <p class="muted" style="margin-bottom:4px"><small>Photo areas ({sel.photoWindows.length}). More than one makes a collage: the participant adds one photo per area.</small></p>
            {#each sel.photoWindows as w, i}
              <div class="win">
                <strong>Area {i + 1}</strong>
                {#each [['x', 'Left'], ['y', 'Top'], ['w', 'Width'], ['h', 'Height']] as [k, l]}
                  <label>{l} <input type="number" bind:value={w[k as 'x']} /></label>
                {/each}
                {#if sel.photoWindows.length > 1}<button class="sm" onclick={() => removeWindow(i)} aria-label={`Remove area ${i + 1}`}>✕</button>{/if}
              </div>
            {/each}
            <div class="row" style="margin:8px 0"><button class="sm" onclick={addWindow} disabled={sel.photoWindows.length >= 6}>+ Add photo area</button></div>
            <div class="row"><button class="sm" onclick={saveWindow}>Save photo areas</button><button class="sm btn danger" onclick={removeTemplate}>Delete frame</button></div>
          </details>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .up { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; justify-content: space-between; }
  .btn.disabled { opacity: .6; pointer-events: none; }
  .chip.on { background: var(--ink); color: #fff; border-color: var(--ink); }
  .editor { display: grid; grid-template-columns: minmax(280px, 460px) 1fr; gap: 20px; align-items: start; margin-top: 16px; }
  @media (max-width: 900px) { .editor { grid-template-columns: 1fr; } }
  .stage { position: sticky; top: 16px; }
  @media (max-width: 900px) { .stage { position: static; } }
  .canvaswrap { position: relative; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: #fff; box-shadow: var(--shadow); touch-action: none; }
  canvas { display: block; width: 100%; height: auto; }
  .overlay { position: absolute; inset: 0; cursor: crosshair; touch-action: none; }
  .box { position: absolute; display: flex; align-items: flex-start; border: 2px dashed var(--coral); background: rgb(232 85 61 / 12%); border-radius: 4px; padding: 0; min-height: 0; }
  .box span { position: absolute; left: -2px; top: -17px; background: var(--coral); color: #fff; font-size: 10px; line-height: 15px; padding: 0 5px; border-radius: 4px 4px 0 0; white-space: nowrap; }
  .box { cursor: move; }
  .box.on { border-style: solid; background: rgb(232 85 61 / 20%); }
  .handle { position: absolute; right: -8px; bottom: -8px; width: 18px; height: 18px; border-radius: 50%; background: var(--coral); border: 3px solid #fff; cursor: nwse-resize; box-shadow: 0 1px 4px rgb(0 0 0 / 35%); }
  .box.ghost { background: rgb(232 85 61 / 25%); pointer-events: none; }
  .panel { display: grid; gap: 16px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
  .form .field { margin-bottom: 12px; }
  .win { display: grid; grid-template-columns: auto repeat(4, minmax(0, 1fr)) auto; gap: 6px; align-items: end; margin: 6px 0; font-size: .8rem; }
  .win input { margin: 2px 0 0; min-height: 36px; padding: 4px 6px; }
  .sw { display: flex; align-items: center; gap: 8px; font-size: .9rem; }
  details summary { cursor: pointer; font-weight: 600; margin-bottom: 4px; }
  .sl { display: grid; grid-template-columns: 56px 1fr 84px; gap: 10px; align-items: center; margin: 6px 0; font-size: .9rem; }
  .sl input[type=range] { margin: 0; min-height: 0; padding: 0; accent-color: var(--coral); cursor: pointer; }
  .sl .num { margin: 0; min-height: 40px; -moz-appearance: textfield; appearance: textfield; }
  .sl .num::-webkit-outer-spin-button, .sl .num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
</style>
