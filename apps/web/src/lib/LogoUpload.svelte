<script lang="ts">
  import { loadImage } from './compositor';

  // Picks an image, shrinks it to a small WebP in the browser, and uploads it. `url` is the current logo.
  let { endpoint, url = $bindable(null), label = 'Logo', onchange }: { endpoint: string; url: string | null; label?: string; onchange?: () => void } = $props();
  let busy = $state(false);
  let err = $state('');

  async function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    busy = true; err = '';
    try {
      const img = await loadImage(f);
      const k = Math.min(1, 512 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      let blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.9));
      if (!blob || blob.type !== 'image/webp') blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
      if (!blob || blob.size > 300_000) throw new Error('That image is too detailed. Try a simpler or smaller logo.');
      const d = new FormData(); d.set('file', new File([blob], 'logo', { type: blob.type }));
      const res = await fetch(endpoint, { method: 'POST', body: d, credentials: 'same-origin' });
      const data = (await res.json().catch(() => ({}))) as { url?: string };
      if (!res.ok || !data.url) throw new Error('Upload failed. Try again.');
      url = `${data.url}?v=${Date.now()}`;
      onchange?.();
    } catch (x) { err = x instanceof Error ? x.message : 'Could not read that image.'; }
    busy = false;
  }

  async function remove() {
    busy = true;
    await fetch(endpoint, { method: 'DELETE', credentials: 'same-origin' });
    url = null; busy = false; onchange?.();
  }
</script>

<div class="lu">
  <div class="prev">{#if url}<img src={url} alt="" />{:else}<span>No logo</span>{/if}</div>
  <div>
    <strong>{label}</strong>
    <div class="row" style="margin-top:6px">
      <label class="btn ghost sm" class:off={busy}>{url ? 'Replace' : 'Upload'}<input type="file" accept="image/png,image/jpeg,image/webp" onchange={pick} disabled={busy} hidden /></label>
      {#if url}<button class="sm" onclick={remove} disabled={busy}>Remove</button>{/if}
    </div>
    {#if err}<small class="error">{err}</small>{/if}
  </div>
</div>

<style>
  .lu { display: flex; gap: 14px; align-items: center; }
  .prev { width: 64px; height: 64px; border-radius: 12px; border: 1px dashed #c9c9c2; background: #fff; display: grid; place-items: center; overflow: hidden; flex: none; }
  .prev img { width: 100%; height: 100%; object-fit: contain; }
  .prev span { font-size: .7rem; color: var(--muted); }
  .off { opacity: .6; pointer-events: none; }
</style>
