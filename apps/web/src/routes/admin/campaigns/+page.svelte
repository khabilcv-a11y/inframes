<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { showIst } from '$lib/time';

  type C = { id: string; title: string; orgName: string; shortCode: string; state: string; startsAt: string; endsAt: string };
  let list = $state<C[]>([]);
  onMount(async () => {
    const r = await api<{ campaigns: C[] }>('/admin/campaigns');
    if (r.status === 401) return goto('/admin/login');
    list = r.data.campaigns;
  });
</script>

<svelte:head><title>Campaigns · InFrame</title></svelte:head>
<main style="padding: 32px 16px; max-width: 860px; margin: auto">
  <p><a href="/admin">← Back</a></p>
  <h1>Campaigns</h1>
  <p><a class="btn" style="display:inline-flex; align-items:center; text-decoration:none" href="/admin/campaigns/new">New campaign</a></p>
  <table style="width:100%; border-collapse:collapse">
    <thead><tr style="text-align:left"><th>Title</th><th>Organisation</th><th>State</th><th>Runs</th></tr></thead>
    <tbody>
      {#each list as c (c.id)}
        <tr style="border-top:1px solid #e3e3de">
          <td><a href={`/admin/campaigns/${c.id}`}>{c.title}</a><br /><small>/c/{c.shortCode}</small></td>
          <td>{c.orgName}</td><td>{c.state}</td><td><small>{showIst(c.startsAt)} → {showIst(c.endsAt)}</small></td>
        </tr>
      {:else}
        <tr><td colspan="4">No campaigns yet.</td></tr>
      {/each}
    </tbody>
  </table>
</main>
