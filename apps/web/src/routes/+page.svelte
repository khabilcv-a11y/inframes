<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import Logo from '$lib/Logo.svelte';
  import Viewfinder from '$lib/Viewfinder.svelte';
  import LogoPuzzle from '$lib/LogoPuzzle.svelte';
  import CampaignCard, { type Card } from '$lib/CampaignCard.svelte';
  import SiteFooter from '$lib/SiteFooter.svelte';

  let cards = $state<Card[]>([]);
  let live = $state<Card[]>([]);
  let q = $state('');
  let timer: ReturnType<typeof setTimeout>;
  let totals = $state({ frames: 0, campaigns: 0, organisations: 0 });
  let shown = $state({ frames: 0, campaigns: 0, organisations: 0 });
  let band = $state<HTMLElement>();

  onMount(() => {
    api<{ campaigns: Card[]; live: Card[]; totals: typeof totals }>('/live').then((r) => { if (r.ok) { cards = r.data.campaigns; live = r.data.live; totals = r.data.totals; } });
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

  function search() {
    clearTimeout(timer);
    timer = setTimeout(async () => { const r = await api<{ campaigns: Card[] }>(`/live?q=${encodeURIComponent(q)}`); if (r.ok) cards = r.data.campaigns; }, 250);
  }
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(n));
  const stories = $derived(cards.filter((c) => c.participants > 0).slice(0, 3));
  const sample = [
    { t: 'Your college', c: '#0a84d6', r: -6 }, { t: 'Your village', c: '#e8553d', r: 4 }, { t: 'Your name', c: '#16161a', r: -3 },
    { t: 'Be part of it', c: '#1f8a4c', r: 6 }, { t: 'Show up', c: '#7c4dff', r: -5 }
  ];

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
  <label class="find"><span class="sr">Search campaigns</span><input type="search" placeholder="Search campaigns" bind:value={q} oninput={search} onfocus={() => document.getElementById('explore')?.scrollIntoView({ behavior: 'smooth' })} /></label>
  <nav aria-label="Main">
    <a href="#explore">Explore</a>
    <a href="#how">How it works</a>
    <a class="btn sm" href="/admin/login">Admin login</a>
  </nav>
</header>

<section class="hero">
  <div class="inner">
    <LogoPuzzle />
    <h1>Every supporter, <span>in the picture.</span></h1>
    <p>Turn your event into a wave of branded photos, made by your participants in seconds, all carrying your message.</p>
    <div class="row cta">
      {#if live.length}<a class="btn big" href={`/c/${live[0].code}`}>Join a live campaign</a>{:else}<a class="btn big" href="#explore">Explore campaigns</a>{/if}
      <a class="btn big ghost" href="/admin/login">Admin login</a>
    </div>
  </div>
</section>

<section id="explore" class="sec">
  <div class="row"><h2 style="margin:0">{q ? 'Results' : live.length ? 'Live now' : 'Campaigns'}</h2><span class="spacer"></span>{#if q}<button class="sm" onclick={() => { q = ''; search(); }}>Clear</button>{/if}</div>
  <p class="muted" style="margin:4px 0 20px">{q ? `Campaigns matching “${q}”` : 'Most supported campaigns right now'}</p>
  {#if cards.length}
    <div class="cards">{#each cards as c (c.code)}<CampaignCard {c} />{/each}</div>
  {:else}
    <p class="empty card">{q ? 'No campaigns match your search.' : 'No live campaigns right now. Check back soon.'}</p>
  {/if}
</section>

{#if stories.length}
  <section class="sec">
    <h2>Making an impact</h2>
    <div class="grid cols-auto">
      {#each stories as c}
        <a class="card story" href={`/c/${c.code}`}>
          <span class="muted">{c.organisation}</span>
          <h3>{c.title}</h3>
          <p>{c.participants > 1 ? `${k(c.participants)} people have joined` : 'The first supporters are joining'} <strong>{c.organisation}</strong> in <em>{c.title}</em>.</p>
          <span class="go">Join them →</span>
        </a>
      {/each}
    </div>
  </section>
{/if}

<section class="collage" aria-label="Examples of frames">
  <h2>Every frame tells who showed up</h2>
  <div class="strip">
    {#each sample as s}
      <div class="mock" style="--c:{s.c}; --r:{s.r}deg">
        <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="36" r="13" /><path d="M22 100c0-20 12-31 28-31s28 11 28 31z" /></svg>
        <b>{s.t}</b>
      </div>
    {/each}
  </div>
</section>

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

<section class="cta">
  <h2>Start something people want to be part of</h2>
  <p>Create a frame campaign for your institution. Free, no design skills needed.</p>
  <a class="btn big" href="/admin/login">Start a campaign</a>
</section>

<SiteFooter />

<style>
  .nav { position: absolute; z-index: 10; top: 0; left: 0; right: 0; display: flex; justify-content: space-between; align-items: center; padding: 16px clamp(16px, 4vw, 48px); }
  .nav nav { display: flex; gap: 20px; align-items: center; }
  .find { flex: 1; max-width: 340px; margin: 0 16px; }
  .find input { margin: 0; border-radius: 999px; border-color: #3a3a44; background: rgb(255 255 255 / 8%); color: #fff; padding-left: 18px; }
  .find input::placeholder { color: #9a9aa6; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  @media (max-width: 760px) { .find { display: none; } }
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
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 24px; }
  .story { text-decoration: none; color: inherit; display: block; transition: transform .2s; }
  .story:hover { transform: translateY(-3px); }
  .story h3 { margin: 6px 0; }
  .collage { max-width: 1100px; margin: 0 auto; padding: 72px clamp(16px, 4vw, 48px) 24px; overflow: hidden; }
  .collage .strip { display: flex; gap: 20px; justify-content: center; flex-wrap: wrap; padding: 24px 0; }
  .mock { position: relative; width: 150px; aspect-ratio: 4/5; border-radius: 16px; background: var(--c); transform: rotate(var(--r)); display: grid; align-content: end; padding: 10px; box-shadow: 0 10px 24px rgb(22 22 26 / 22%); transition: transform .25s; }
  .mock:hover { transform: rotate(0) scale(1.06); }
  .mock svg { position: absolute; left: 10%; top: 8%; width: 80%; fill: #f4f4ef; opacity: .95; }
  .mock b { position: relative; color: #fff; text-align: center; font: 700 .95rem var(--display); background: rgb(0 0 0 / 28%); border-radius: 8px; padding: 6px; }
  .cta { text-align: center; padding: 72px 16px; }
  .cta p { color: var(--muted); }  .go { color: var(--coral-600); font-weight: 600; }
  :global(.step) { padding: 28px 24px; }
  .num { font: 700 2.6rem var(--display); color: var(--coral); display: block; margin-bottom: 6px; }

  .band { background: var(--ink); color: #fff; display: flex; justify-content: space-around; flex-wrap: wrap; gap: 24px; padding: 56px clamp(16px, 4vw, 48px); text-align: center; }
  .band b { display: block; font: 700 clamp(2.4rem, 6vw, 4rem)/1 var(--display); color: var(--coral); letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
  .band span { color: #b9b9c4; }

</style>
