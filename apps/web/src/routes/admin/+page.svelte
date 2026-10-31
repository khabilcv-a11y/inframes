<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import PageHeader from '$lib/PageHeader.svelte';

  type O = { campaigns: number; live: number; upcoming: number; drafts: number; framesTotal: number; frames24h: number; activeAdmins: number | null; organisations: number | null; recent: { id: string; title: string; state: string; shortCode: string }[] };
  let o = $state<O | null>(null);
  onMount(async () => { const r = await api<O>('/admin/overview'); if (r.ok) o = r.data; });
  const canCreate = $derived(session.user?.role !== 'viewer');
</script>

<svelte:head><title>Dashboard · InFrame</title></svelte:head>
<PageHeader title={`Welcome, ${session.user?.name.split(' ')[0] ?? ''}`} subtitle="Here is what is happening across your campaigns.">
  {#snippet actions()}{#if canCreate}<a class="btn" href="/admin/campaigns/new">+ New campaign</a>{/if}{/snippet}
</PageHeader>

{#if o}
  <div class="grid cols-auto">
    <div class="card stat"><div class="n">{o.live}</div><div class="l">Live now</div></div>
    <div class="card stat"><div class="n">{o.upcoming}</div><div class="l">Scheduled</div></div>
    <div class="card stat"><div class="n">{o.framesTotal.toLocaleString('en-IN')}</div><div class="l">Frames created</div></div>
    <div class="card stat"><div class="n">{o.frames24h.toLocaleString('en-IN')}</div><div class="l">Last 24 hours</div></div>
    {#if o.activeAdmins !== null}
      <div class="card stat"><div class="n">{o.organisations}</div><div class="l">Organisations</div></div>
      <div class="card stat"><div class="n">{o.activeAdmins}</div><div class="l">Active admins</div></div>
    {/if}
  </div>

  <h2 style="margin-top:32px">Recent campaigns</h2>
  <div class="card" style="padding:0">
    {#each o.recent as c (c.id)}
      <a class="item" href={`/admin/campaigns/${c.id}`}><strong>{c.title}</strong><span class="badge {c.state}">{c.state}</span><span class="spacer"></span><small>/c/{c.shortCode}</small></a>
    {:else}
      <div class="empty">
        <p>No campaigns yet.</p>
        {#if canCreate}<a class="btn" href="/admin/campaigns/new">Create your first campaign</a>{/if}
      </div>
    {/each}
  </div>
{:else}
  <p class="muted">Loading…</p>
{/if}

<style>
  .item { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid var(--line); text-decoration: none; color: inherit; }
  .item:last-child { border-bottom: 0; }
  .item:hover { background: #f8f8f4; }
</style>
