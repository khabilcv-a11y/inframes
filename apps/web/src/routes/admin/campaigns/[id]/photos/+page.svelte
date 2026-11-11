<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import { current } from '$lib/campaign.svelte';
  import { detectFaces, faceSignature, jpegCopy, loadFaceModels, openImage } from '$lib/face';

  type P = { id: string; name: string; faces: number };
  const id = page.params.id!;
  const canEdit = $derived(session.user?.role !== 'viewer');
  let photos = $state<P[]>([]);
  let faces = $state(0);
  let months = $state(31);
  let needsSetup = $state(false);
  let busy = $state(false);
  let stop = false;
  let prog = $state({ done: 0, total: 0, added: 0, skipped: 0, failed: 0, faces: 0, note: '' });
  let driveUrl = $state('');
  let err = $state('');
  let copied = $state(false);
  const link = $derived(current.c ? `${location.origin}/c/${current.c.shortCode}/photos` : '');

  async function load() {
    const r = await api<{ photos: P[]; faces: number; retentionMonths: number }>(`/admin/campaigns/${id}/photos`);
    if (r.ok) { photos = r.data.photos; faces = r.data.faces; months = r.data.retentionMonths; needsSetup = false; }
    else if (r.status >= 500) needsSetup = true;
  }
  onMount(load);

  type Item = { name: string; get: () => Promise<Blob> };

  /** Reads each picture, finds the faces on this computer, and stores a preview, a web-size copy and the face signatures. */
  async function run(items: Item[]) {
    err = ''; stop = false; busy = true;
    prog = { done: 0, total: items.length, added: 0, skipped: 0, failed: 0, faces: 0, note: 'Preparing the face finder (first time only, about 50 MB)…' };
    try {
      await loadFaceModels();
      const have = new Set(photos.map((p) => p.name));
      for (const it of items) {
        if (stop) break;
        prog.note = it.name;
        if (have.has(it.name)) { prog.skipped++; prog.done++; continue; }
        try {
          const bm = await openImage(await it.get());
          const found = (await detectFaces(bm)).slice(0, 60);
          const all = new Float32Array(found.length * 128);
          for (let i = 0; i < found.length; i++) all.set(await faceSignature(bm, found[i]), i * 128);
          const f = new FormData();
          f.set('thumb', new File([await jpegCopy(bm, 360, 80_000)], 't.jpg', { type: 'image/jpeg' }));
          f.set('view', new File([await jpegCopy(bm, 1600, 1_150_000)], 'v.jpg', { type: 'image/jpeg' }));
          f.set('name', it.name.slice(0, 200)); f.set('width', String(bm.width)); f.set('height', String(bm.height));
          let s = ''; const u8 = new Uint8Array(all.buffer);
          for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
          f.set('embs', btoa(s));
          bm.close();
          const res = await fetch(`/api/admin/campaigns/${id}/photos`, { method: 'POST', body: f, credentials: 'same-origin' });
          if (res.status === 409) prog.skipped++;
          else if (!res.ok) { prog.failed++; if (res.status >= 500) { needsSetup = true; break; } }
          else { prog.added++; prog.faces += found.length; }
        } catch { prog.failed++; }
        prog.done++;
      }
    } catch { err = 'Could not start the face finder. Check your connection and try again.'; }
    busy = false; prog.note = '';
    await load();
  }

  const isImage = (n: string) => /\.(jpe?g|png|webp)$/i.test(n);
  function pickFolder(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []).filter((f) => isImage(f.name));
    input.value = '';
    if (!files.length) { err = 'No JPG, PNG or WebP pictures were found there.'; return; }
    run(files.map((f) => ({ name: f.name, get: async () => f })));
  }
  async function fromDrive(e: SubmitEvent) {
    e.preventDefault(); err = '';
    const r = await api<{ files?: { id: string; name: string }[]; error?: string }>(`/admin/drive-folder?url=${encodeURIComponent(driveUrl)}`);
    if (!r.ok) { err = r.data.error === 'bad_url' ? 'That is not a Google Drive folder link.' : 'Could not read that folder. In Google Drive: Share → General access → “Anyone with the link”, then try again.'; return; }
    const files = (r.data.files ?? []).filter((f) => isImage(f.name));
    if (!files.length) { err = 'No JPG, PNG or WebP pictures were found directly inside that folder (pictures in sub-folders are not read).'; return; }
    run(files.map((f) => ({ name: f.name, get: async () => { const x = await fetch(`/api/admin/drive-file/${f.id}`, { credentials: 'same-origin' }); if (!x.ok) throw new Error('drive'); return x.blob(); } })));
  }
  async function removeAll() {
    if (!confirm(`Delete all ${photos.length} event photos and their face data for this campaign? This cannot be undone.`)) return;
    await api(`/admin/campaigns/${id}/photos`, { method: 'DELETE' });
    await load();
  }
  async function removeOne(p: P) { await api(`/admin/photos/${p.id}`, { method: 'DELETE' }); await load(); }
  async function copy() { try { await navigator.clipboard.writeText(link); copied = true; setTimeout(() => (copied = false), 2000); } catch { /* ignore */ } }
</script>

<p class="badge draft" style="margin-bottom:12px">Beta</p>

{#if needsSetup}
  <p class="card bad" role="alert">This module needs one database step first (step 0006). Ask Claude for the SQL, run it in the D1 console, then reload this page.</p>
{/if}
{#if err}<p class="card bad" role="alert">{err}</p>{/if}

<div class="two">
  <div class="grid">
    {#if canEdit}
      <section class="card">
        <h2>Add event photos</h2>
        <p class="muted">Faces are found on this computer. InFrame keeps a preview, a web-size copy (up to 1600 px) and each face's number signature. They are deleted automatically after {months} months.</p>
        <div class="opts">
          <div>
            <h3>From this computer</h3>
            <label class="btn" class:off={busy}>Choose a folder<input type="file" webkitdirectory multiple onchange={pickFolder} disabled={busy} hidden /></label>
            <label class="btn ghost" class:off={busy} style="margin-left:8px">Choose pictures<input type="file" accept="image/jpeg,image/png,image/webp" multiple onchange={pickFolder} disabled={busy} hidden /></label>
          </div>
          <form onsubmit={fromDrive}>
            <h3>From a Google Drive folder</h3>
            <div class="row" style="align-items:flex-start">
              <input style="flex:1; min-width:220px; margin:0" required placeholder="https://drive.google.com/drive/folders/…" bind:value={driveUrl} disabled={busy} />
              <button class="btn" disabled={busy}>Read folder</button>
            </div>
            <small class="muted">The folder must be shared as “Anyone with the link”. Pictures directly inside it are read (not sub-folders).</small>
          </form>
        </div>

        {#if busy || prog.total}
          <div class="prog" role="status">
            <div class="track"><i style="width:{prog.total ? (prog.done / prog.total) * 100 : 0}%"></i></div>
            <p><strong>{prog.done} / {prog.total}</strong> · added {prog.added} · already there {prog.skipped} · could not read {prog.failed} · faces found {prog.faces}</p>
            {#if busy}<p class="muted"><small>{prog.note}</small> <button class="sm" onclick={() => (stop = true)}>Stop</button></p><p class="muted"><small>Keep this tab open until it finishes.</small></p>{/if}
          </div>
        {/if}
      </section>
    {/if}

    <section class="card" style="padding:0">
      <div class="row" style="padding:16px 20px"><h2 style="margin:0">{photos.length} photos · {faces} faces</h2><span class="spacer"></span>{#if canEdit && photos.length}<button class="sm btn danger" onclick={removeAll} disabled={busy}>Delete all</button>{/if}</div>
      {#if photos.length}
        <div class="thumbs">
          {#each photos.slice(0, 120) as p (p.id)}
            <figure>
              <img src={`/api/photos/${p.id}/thumb`} alt={p.name} loading="lazy" />
              <figcaption title={p.name}>{p.faces} face{p.faces === 1 ? '' : 's'}{#if canEdit}<button class="x" aria-label={`Delete ${p.name}`} onclick={() => removeOne(p)}>✕</button>{/if}</figcaption>
            </figure>
          {/each}
        </div>
        {#if photos.length > 120}<p class="muted" style="padding:0 20px 16px"><small>Showing the first 120.</small></p>{/if}
      {:else}<p class="empty">No event photos yet.</p>{/if}
    </section>
  </div>

  <aside class="card">
    <h2>Find my photos</h2>
    <p class="muted">Share this link. People take a selfie and see the photos they are in. The selfie stays on their phone.</p>
    <div class="linkbox">{link}</div>
    <div class="row" style="margin-top:12px"><button class="sm" onclick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</button><a class="btn ghost sm" href={link} target="_blank" rel="noopener">Try it ↗</a></div>
    {#if current.c?.state === 'draft'}<p class="muted" style="margin-top:12px"><small>The link works once the campaign is published.</small></p>{/if}
  </aside>
</div>

<style>
  .two { display: grid; grid-template-columns: 1fr 300px; gap: 20px; align-items: start; }
  @media (max-width: 900px) { .two { grid-template-columns: 1fr; } }
  .opts { display: grid; gap: 20px; }
  .opts h3 { margin-bottom: 8px; }
  .off { opacity: .6; pointer-events: none; }
  .bad { background: var(--bad-bg); border-color: #efc5c2; color: var(--bad); font-weight: 600; margin-bottom: 16px; }
  .prog { margin-top: 20px; }
  .prog p { margin: 8px 0 0; }
  .track { height: 10px; background: #eeeee9; border-radius: 99px; overflow: hidden; }
  .track i { display: block; height: 100%; background: var(--coral); transition: width .2s; }
  .thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; padding: 0 20px 20px; }
  figure { margin: 0; }
  figure img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 10px; background: #eee; display: block; }
  figcaption { display: flex; justify-content: space-between; align-items: center; font-size: .78rem; color: var(--muted); margin-top: 4px; }
  .x { min-height: 0; padding: 0 6px; border: 0; background: none; color: var(--muted); }
  .linkbox { background: #f3f3ee; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; font: 500 .85rem monospace; overflow-wrap: anywhere; }
</style>
