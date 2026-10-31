<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';

  type Org = { id: string; name: string; status: string; admins: number; campaigns: number };
  let orgs = $state<Org[]>([]);
  let name = $state('');
  let error = $state('');

  async function load() {
    const r = await api<{ organisations: Org[] }>('/super/organisations');
    if (r.status === 401) return goto('/admin/login');
    if (r.status === 403) return goto('/admin');
    orgs = r.data.organisations;
  }
  onMount(load);

  async function create(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    const r = await api('/super/organisations', { method: 'POST', body: JSON.stringify({ name }) });
    if (!r.ok) { error = 'Enter a name of at least 2 characters.'; return; }
    name = '';
    await load();
  }

  async function toggle(o: Org) {
    await api(`/super/organisations/${o.id}`, { method: 'PATCH', body: JSON.stringify({ status: o.status === 'active' ? 'inactive' : 'active' }) });
    await load();
  }
</script>

<svelte:head><title>Organisations · InFrame</title></svelte:head>
<main style="padding: 32px 16px; max-width: 760px; margin: auto">
  <p><a href="/admin">← Back</a></p>
  <h1>Organisations</h1>
  <form onsubmit={create} style="display:flex; gap:8px; align-items:end">
    <label class="field" style="flex:1; margin:0">New organisation <input required minlength="2" bind:value={name} placeholder="e.g. DCIP Kozhikode" /></label>
    <button class="btn">Add</button>
  </form>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <table style="width:100%; margin-top:24px; border-collapse:collapse">
    <thead><tr style="text-align:left"><th>Name</th><th>Admins</th><th>Campaigns</th><th>Status</th><th></th></tr></thead>
    <tbody>
      {#each orgs as o (o.id)}
        <tr style="border-top:1px solid #e3e3de">
          <td>{o.name}</td><td>{o.admins}</td><td>{o.campaigns}</td><td>{o.status}</td>
          <td><button onclick={() => toggle(o)}>{o.status === 'active' ? 'Deactivate' : 'Activate'}</button></td>
        </tr>
      {:else}
        <tr><td colspan="5">No organisations yet.</td></tr>
      {/each}
    </tbody>
  </table>
</main>
