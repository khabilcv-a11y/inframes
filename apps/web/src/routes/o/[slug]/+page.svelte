<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import Logo from '$lib/Logo.svelte';
  import CampaignCard, { type Card } from '$lib/CampaignCard.svelte';
  import SiteFooter from '$lib/SiteFooter.svelte';

  type O = { name: string; logoUrl: string | null; supporters: number; campaigns: Card[] };
  let o = $state<O | null>(null);
  let missing = $state(false);
  onMount(async () => { const r = await api<O>(`/o/${page.params.slug}`); if (r.ok) o = r.data; else missing = true; });
</script>

<svelte:head><title>{o?.name ?? 'Organiser'} · campaigns</title></svelte:head>
<header class="top"><a href="/" aria-label="InFrame home"><Logo size={24} dark /></a><a class="btn sm" href="/#explore">Explore</a></header>

<main>
  {#if missing}
    <div class="center"><h1>Organiser not found</h1><p><a href="/">Back to home</a></p></div>
  {:else if o}
    <section class="head">
      {#if o.logoUrl}<img class="logo" src={o.logoUrl} alt="" />{:else}<span class="logo ph">{o.name.slice(0, 1)}</span>{/if}
      <div>
        <h1>{o.name}</h1>
        <p class="muted">{o.campaigns.length} campaign{o.campaigns.length === 1 ? '' : 's'} · {o.supporters.toLocaleString('en-IN')} supporter{o.supporters === 1 ? '' : 's'}</p>
      </div>
    </section>
    {#if o.campaigns.length}
      <div class="cards">{#each o.campaigns as c (c.code)}<CampaignCard {c} />{/each}</div>
    {:else}<p class="empty card">No public campaigns yet.</p>{/if}
  {/if}
</main>
<SiteFooter compact />

<style>
  .top { background: var(--ink); display: flex; justify-content: space-between; align-items: center; padding: 14px clamp(16px, 4vw, 48px); }
  main { max-width: 1100px; margin: 0 auto; padding: 40px clamp(16px, 4vw, 48px) 48px; min-height: 60vh; }
  .head { display: flex; align-items: center; gap: 20px; margin-bottom: 32px; }
  .head h1 { margin: 0; }
  .head p { margin: 4px 0 0; }
  .logo { width: 84px; height: 84px; border-radius: 50%; object-fit: cover; background: #fff; border: 1px solid var(--line); box-shadow: var(--shadow); }
  .logo.ph { display: grid; place-items: center; background: var(--ink); color: #fff; font: 700 2rem var(--display); border: 0; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 24px; }
  .center { text-align: center; padding: 80px 0; }
</style>
