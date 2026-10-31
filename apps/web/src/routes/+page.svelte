<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import Logo from '$lib/Logo.svelte';
  import Viewfinder from '$lib/Viewfinder.svelte';
  import LogoPuzzle from '$lib/LogoPuzzle.svelte';

  type Live = { title: string; organisation: string; code: string; participants: number };
  let live = $state<Live[]>([]);
  let totals = $state({ frames: 0, campaigns: 0, organisations: 0 });
  let shown = $state({ frames: 0, campaigns: 0, organisations: 0 });
  let band = $state<HTMLElement>();

  onMount(() => {
    api<{ live: Live[]; totals: typeof totals }>('/live').then((r) => { if (r.ok) { live = r.data.live; totals = r.data.totals; } });
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const t0 = performance.now();
      const tick = (t: number) => {
        const k = reduce ? 1 : Math.min(1, (t - t0) / 1200), ease = 1 - Math.pow(1 - k, 3);
        shown = { frames: Math.round(totals.frames * ease), campaigns: Math.round(totals.campaigns * ease), organisations: Math.round(totals.organisations * ease) };
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    if (band) io.observe(band);
    return () => io.disconnect();
  });

  const steps = [
    { n: '1', t: 'Open the link', d: 'Scan the QR code or tap the link shared by the organiser.' },
    { n: '2', t: 'Add your photo and name', d: 'Pick a photo, fit it in the frame, and type your name and college.' },
    { n: '3', t: 'Share it everywhere', d: 'One tap to WhatsApp, Instagram or Status. Ready in seconds.' }
  ];
  const why = [
    { t: 'The campaign records itself', d: 'Every participant adds a moment, so your event documents itself as it happens.' },
    { t: 'One look, everywhere', d: 'The same frame, colours and hashtag on every post make scattered shares read as one campaign.' },
    { t: 'Reach beyond the room', d: 'People share pictures of themselves far more than posters, and each share reaches a new network.' },
    { t: 'On your schedule', d: 'Frames go live and close with your event, from launch hour to last call.' }
  ];
</script>

<svelte:head>
  <title>InFrame — Be part of the picture</title>
  <meta name="description" content="Branded photo frames for event campaigns. Participants turn their own photo into a framed, named, ready-to-share picture in under a minute." />
</svelte:head>

<header class="nav">
  <a href="/" aria-label="InFrame home"><Logo size={28} dark /></a>
  <nav aria-label="Main">
    <a href="#how">How it works</a>
    <a href="#why">Why it works</a>
    {#if live.length}<a href="#live">Live now</a>{/if}
    <a class="btn sm" href="/admin/login">Admin login</a>
  </nav>
</header>

<section class="hero">
  <div class="inner">
    <LogoPuzzle />
    <h1>Every supporter, <span>in the picture.</span></h1>
    <p>Turn your event into a wave of branded photos, made by your participants in seconds, all carrying your message.</p>
    <div class="row cta">
      {#if live.length}<a class="btn big" href={`/c/${live[0].code}`}>Join a live campaign</a>{/if}
      <a class="btn big ghost" href="/admin/login">Admin login</a>
    </div>
  </div>
</section>

{#if live.length}
  <section id="live" class="sec">
    <h2>Live now</h2>
    <div class="grid cols-auto">
      {#each live as c}
        <a class="card live" href={`/c/${c.code}`}>
          <span class="badge live">live</span>
          <h3>{c.title}</h3>
          <p class="muted">{c.organisation}</p>
          <p><strong>{c.participants.toLocaleString('en-IN')}</strong> <span class="muted">frames created</span></p>
          <span class="go">Get your frame →</span>
        </a>
      {/each}
    </div>
  </section>
{/if}

<section id="how" class="sec">
  <h2>How it works</h2>
  <div class="grid cols-auto steps">
    {#each steps as s}
      <Viewfinder class="step"><span class="num">{s.n}</span><h3>{s.t}</h3><p class="muted">{s.d}</p></Viewfinder>
    {/each}
  </div>
</section>

<section id="why" class="sec alt">
  <h2>Why it works</h2>
  <div class="grid cols-auto">
    {#each why as w}<div class="card"><h3>{w.t}</h3><p class="muted" style="margin:0">{w.d}</p></div>{/each}
  </div>
</section>

<section class="band" bind:this={band} aria-label="InFrame in numbers">
  <div><b>{shown.frames.toLocaleString('en-IN')}</b><span>frames created</span></div>
  <div><b>{shown.campaigns.toLocaleString('en-IN')}</b><span>campaigns run</span></div>
  <div><b>{shown.organisations.toLocaleString('en-IN')}</b><span>organisations served</span></div>
</section>

<footer class="foot">
  <Logo size={22} dark />
  <span>Be part of the picture.</span>
  <span class="spacer"></span>
  <a href="/admin/login">Admin login</a>
</footer>

<style>
  .nav { position: absolute; z-index: 10; top: 0; left: 0; right: 0; display: flex; justify-content: space-between; align-items: center; padding: 16px clamp(16px, 4vw, 48px); }
  .nav nav { display: flex; gap: 20px; align-items: center; }
  .nav nav a:not(.btn) { color: #c9c9d1; text-decoration: none; font-weight: 500; }
  .nav nav a:not(.btn):hover { color: #fff; }
  @media (max-width: 640px) { .nav nav a:not(.btn) { display: none; } }

  .hero { background: radial-gradient(900px 400px at 50% 0%, #26262e 0%, var(--ink) 70%); color: #fff; padding: 88px clamp(16px, 4vw, 48px) 72px; text-align: center; }
  .inner { max-width: 960px; margin: 0 auto; }
  .hero h1 { font-size: clamp(2.4rem, 7vw, 5rem); line-height: 1.02; letter-spacing: -0.035em; margin: 24px 0 16px; }
  .hero h1 span { color: var(--coral); }
  .hero p { max-width: 640px; margin: 0 auto 28px; color: #b9b9c4; font-size: 1.1rem; }
  .cta { justify-content: center; }
  .btn.big { min-height: 52px; padding: 0 28px; font-size: 1.02rem; }
  .hero .btn.ghost { color: #fff; border-color: #44444e; }
  .hero .btn.ghost:hover { background: #24242b !important; }

  .sec { max-width: 1100px; margin: 0 auto; padding: 72px clamp(16px, 4vw, 48px) 8px; }
  .sec.alt { padding-bottom: 72px; }
  .sec h2 { font-size: clamp(1.6rem, 3.5vw, 2.3rem); margin-bottom: 24px; }
  .live { text-decoration: none; color: inherit; display: block; transition: transform .2s, box-shadow .2s; }
  .live:hover { transform: translateY(-3px); box-shadow: 0 8px 28px rgb(22 22 26 / 12%); }
  .live h3 { margin: 12px 0 2px; }
  .go { color: var(--coral-600); font-weight: 600; }
  :global(.step) { padding: 28px 24px; }
  .num { font: 700 2.6rem var(--display); color: var(--coral); display: block; margin-bottom: 6px; }

  .band { background: var(--ink); color: #fff; display: flex; justify-content: space-around; flex-wrap: wrap; gap: 24px; padding: 56px clamp(16px, 4vw, 48px); text-align: center; }
  .band b { display: block; font: 700 clamp(2.4rem, 6vw, 4rem)/1 var(--display); color: var(--coral); letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
  .band span { color: #b9b9c4; }

  .foot { background: var(--ink); color: #9a9aa6; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; padding: 24px clamp(16px, 4vw, 48px); border-top: 1px solid #2a2a31; }
  .foot a { color: #c9c9d1; }
</style>
