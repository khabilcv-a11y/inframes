<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import { detectFaces, faceSignature, loadFaceModels, openImage } from '$lib/face';

  type M = { id: string; name: string; score: number };
  const code = page.params.code!;
  let title = $state('');
  let organisation = $state('');
  let total = $state<number | null>(null);
  let missing = $state(false);
  let stage = $state<'start' | 'working' | 'results'>('start');
  let note = $state('');
  let err = $state('');
  let strong = $state<M[]>([]);
  let possible = $state<M[]>([]);
  let open = $state<M | null>(null);

  onMount(async () => {
    const [c, i] = await Promise.all([api<{ title: string; organisation: string }>(`/c/${code}`), api<{ photos: number }>(`/c/${code}/photos/info`)]);
    if (!c.ok) { missing = true; return; }
    title = c.data.title; organisation = c.data.organisation;
    total = i.ok ? i.data.photos : 0;
  });

  async function onSelfie(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    err = ''; stage = 'working'; note = 'Getting ready (the first time takes longer)…';
    try {
      await loadFaceModels((p) => (note = `Getting ready… ${Math.round(p * 100)}%`));
      note = 'Looking at your selfie…';
      const bm = await openImage(f);
      const faces = await detectFaces(bm);
      if (!faces.length) { err = 'No face was found in that picture. Try again in good light, facing the camera.'; stage = 'start'; return; }
      const me = faces.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a)); // the biggest face is the person taking the selfie
      const emb = await faceSignature(bm, me);
      bm.close();
      note = 'Searching the event photos…';
      const r = await api<{ strong: M[]; possible: M[] }>(`/c/${code}/photos/match`, { method: 'POST', body: JSON.stringify({ emb: [...emb] }) });
      if (!r.ok) throw new Error('match');
      strong = r.data.strong; possible = r.data.possible;
      stage = 'results';
    } catch { err = 'Something went wrong. Check your connection and try again.'; stage = 'start'; }
  }
  const again = () => { stage = 'start'; strong = []; possible = []; };
</script>

<svelte:head><title>Find my photos · {title || 'Event'}</title><meta name="robots" content="noindex" /></svelte:head>

<div class="page">
  <header><a href={`/c/${code}`}>← {title || 'Back'}</a><small>{organisation}</small></header>
  <main>
    {#if missing}
      <div class="center"><h1>Event not found</h1><p class="muted">Check the link and try again.</p></div>
    {:else if total === null}
      <p class="center muted">…</p>
    {:else if total === 0}
      <div class="center"><h1>No photos yet</h1><p class="muted">The organiser has not added this event's photos yet. Please check back later.</p></div>
    {:else if stage === 'start'}
      <div class="center">
        <h1>Find my photos</h1>
        <p>Take a selfie and we will show the photos you are in, out of {total.toLocaleString('en-IN')} from this event.</p>
        <label class="btn big block">Take a selfie<input type="file" accept="image/*" capture="user" onchange={onSelfie} hidden /></label>
        <label class="link">or choose a photo of yourself<input type="file" accept="image/*" onchange={onSelfie} hidden /></label>
        {#if err}<p class="error" role="alert">{err}</p>{/if}
        <p class="privacy">Your selfie stays on your phone. Only a number pattern of your face is sent to find matches, and it is not saved.</p>
      </div>
    {:else if stage === 'working'}
      <div class="center"><div class="spin" aria-hidden="true"></div><p role="status">{note}</p></div>
    {:else}
      <h1>{strong.length ? `We found you in ${strong.length} photo${strong.length === 1 ? '' : 's'}` : 'No sure matches'}</h1>
      {#if !strong.length}<p class="muted">Try another selfie in good light, facing the camera and without sunglasses or a mask.</p>{/if}
      <div class="grid">
        {#each strong as m (m.id)}<button class="tile" onclick={() => (open = m)}><img src={`/api/photos/${m.id}/thumb`} alt="Event photo" loading="lazy" /></button>{/each}
      </div>
      {#if possible.length}
        <h2>Possible matches</h2>
        <p class="muted">These look similar but we are less sure. Some may be other people.</p>
        <div class="grid">
          {#each possible as m (m.id)}<button class="tile dim" onclick={() => (open = m)}><img src={`/api/photos/${m.id}/thumb`} alt="Event photo" loading="lazy" /></button>{/each}
        </div>
      {/if}
      <p style="text-align:center; margin-top:24px"><button class="btn ghost" onclick={again}>Try another selfie</button></p>
    {/if}
  </main>
  <footer><a href="/">Powered by InFrame</a> · Designed &amp; developed by <strong>CV</strong></footer>
</div>

{#if open}
  <div class="viewer" role="dialog" aria-modal="true" aria-label="Photo">
    <img src={`/api/photos/${open.id}/view`} alt="Event photo" />
    <div class="row">
      <a class="btn" href={`/api/photos/${open.id}/view?download=1`}>Download</a>
      <button class="btn ghost light" onclick={() => (open = null)}>Close</button>
    </div>
  </div>
{/if}

<style>
  .page { min-height: 100vh; display: flex; flex-direction: column; max-width: 720px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 16px; }
  header a { text-decoration: none; font-weight: 600; color: var(--ink); }
  main { flex: 1; padding: 0 16px 24px; }
  .center { text-align: center; padding: 40px 8px; max-width: 480px; margin: 0 auto; }
  .btn.big { min-height: 56px; font-size: 1.05rem; cursor: pointer; }
  .link { display: block; margin: 14px 0; color: var(--coral-600); text-decoration: underline; cursor: pointer; }
  .privacy { font-size: .85rem; color: var(--muted); margin-top: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; margin: 12px 0; }
  .tile { padding: 0; border: 0; min-height: 0; border-radius: 12px; overflow: hidden; background: #eee; }
  .tile img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
  .tile.dim img { opacity: .85; }
  h2 { margin-top: 28px; }
  .spin { width: 44px; height: 44px; margin: 0 auto 16px; border-radius: 50%; border: 4px solid #e6e6e0; border-top-color: var(--coral); animation: s 1s linear infinite; }
  @keyframes s { to { transform: rotate(360deg); } }
  .viewer { position: fixed; inset: 0; z-index: 50; background: rgb(22 22 26 / 94%); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 16px; }
  .viewer img { max-width: 100%; max-height: 78vh; border-radius: 10px; }
  .light { color: #fff; border-color: #55555f; }
  footer { text-align: center; padding: 16px; font-size: .8rem; color: var(--muted); }
  footer a { color: var(--muted); }
  footer strong { color: var(--coral); }
</style>
