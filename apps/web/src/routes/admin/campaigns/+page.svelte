<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import { showIst } from '$lib/time';
  import PageHeader from '$lib/PageHeader.svelte';

  type C = { id: string; title: string; orgName: string; shortCode: string; state: string; startsAt: string; endsAt: string };
  let list = $state<C[]>([]);
  let loaded = $state(false);
  let filter = $state('all');
  onMount(async () => { const r = await api<{ campaigns: C[] }>('/admin/campaigns'); if (r.ok) list = r.data.campaigns; loaded = true; });
  const shown = $derived(filter === 'all' ? list : list.filter((c) => c.state === filter));
  const states = ['all', 'live', 'scheduled', 'draft', 'paused', 'ended'];
</script>

<svelte:head><title>Campaigns · InFrame</title></svelte:head>
<PageHeader title="Campaigns">
  {#snippet actions()}{#if session.user?.role !== 'viewer'}<a class="btn" href="/admin/campaigns/new">+ New campaign</a>{/if}{/snippet}
</PageHeader>

<div class="row" style="margin-bottom:16px" role="tablist" aria-label="Filter by state">
  {#each states as s}
    <button class="sm chip" class:on={filter === s} onclick={() => (filter = s)}>{s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}</button>
  {/each}
</div>

<div class="card" style="padding:0">
  <div class="table-wrap">
    <table class="t">
      <thead><tr><th>Campaign</th><th>Organisation</th><th>State</th><th>Runs (India time)</th></tr></thead>
      <tbody>
        {#each shown as c (c.id)}
          <tr>
            <td><a href={`/admin/campaigns/${c.id}`}><strong>{c.title}</strong></a><br /><small>/c/{c.shortCode} · <a href={`/admin/campaigns/${c.id}/photos`}>Event photos</a></small></td>
            <td>{c.orgName}</td>
            <td><span class="badge {c.state}">{c.state}</span></td>
            <td><small>{showIst(c.startsAt)} → {showIst(c.endsAt)}</small></td>
          </tr>
        {:else}
          <tr><td colspan="4" class="empty">{loaded ? 'No campaigns here yet.' : 'Loading…'}</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .chip.on { background: var(--ink); color: #fff; border-color: var(--ink); }
</style>
