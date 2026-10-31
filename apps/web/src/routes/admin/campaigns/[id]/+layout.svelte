<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { loadCampaign, current } from '$lib/campaign.svelte';
  import { showIst } from '$lib/time';
  import PageHeader from '$lib/PageHeader.svelte';

  let { children } = $props();
  const id = $derived(page.params.id);

  $effect(() => { current.c = null; loadCampaign(id!).then((r) => { if (!r.ok) goto('/admin/campaigns'); }); });

  const tabs = $derived([
    { href: `/admin/campaigns/${id}`, label: 'Overview' },
    { href: `/admin/campaigns/${id}/frames`, label: 'Frames & titles' },
    { href: `/admin/campaigns/${id}/results`, label: 'Results' }
  ]);
</script>

{#if current.c}
  <PageHeader title={current.c.title} back="Campaigns" backHref="/admin/campaigns"
    subtitle={`${current.c.orgName} · ${showIst(current.c.startsAt)} → ${showIst(current.c.endsAt)}`}>
    {#snippet actions()}<span class="badge {current.c!.state}">{current.c!.state}</span>{/snippet}
  </PageHeader>
  <nav class="tabs" aria-label="Campaign sections">
    {#each tabs as t}<a href={t.href} class:on={page.url.pathname === t.href}>{t.label}</a>{/each}
  </nav>
  {@render children()}
{:else}
  <p class="muted">Loading…</p>
{/if}

<style>
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 24px; overflow-x: auto; }
  .tabs a { padding: 10px 16px; text-decoration: none; color: var(--muted); font-weight: 600; border-bottom: 3px solid transparent; white-space: nowrap; }
  .tabs a:hover { color: var(--ink); }
  .tabs a.on { color: var(--ink); border-bottom-color: var(--coral); }
</style>
