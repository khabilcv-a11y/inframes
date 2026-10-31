<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { showIst } from '$lib/time';
  import PageHeader from '$lib/PageHeader.svelte';

  type E = { id: number; action: string; userName: string; email: string; targetType: string | null; createdAt: string; detail: string | null };
  let entries = $state<E[]>([]);
  let offset = $state(0);
  let more = $state(false);
  const LIMIT = 50;

  async function load() {
    const r = await api<{ entries: E[] }>(`/super/audit?limit=${LIMIT}&offset=${offset}`);
    if (r.status === 403) return goto('/admin');
    if (r.ok) { entries = [...entries, ...r.data.entries]; more = r.data.entries.length === LIMIT; offset += r.data.entries.length; }
  }
  onMount(load);
  const pretty = (a: string) => a.replace('.', ' · ').replaceAll('_', ' ');
</script>

<svelte:head><title>Activity log · InFrame</title></svelte:head>
<PageHeader title="Activity log" subtitle="Every admin action, newest first." />
<div class="card" style="padding:0">
  <div class="table-wrap">
    <table class="t">
      <thead><tr><th>When</th><th>Who</th><th>Action</th></tr></thead>
      <tbody>
        {#each entries as e (e.id)}
          <tr><td><small>{showIst(e.createdAt)}</small></td><td>{e.userName}<br /><small>{e.email}</small></td><td><code>{pretty(e.action)}</code></td></tr>
        {:else}<tr><td colspan="3" class="empty">Nothing yet.</td></tr>{/each}
      </tbody>
    </table>
  </div>
</div>
{#if more}<p style="margin-top:16px"><button onclick={load}>Load more</button></p>{/if}
