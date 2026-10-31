<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import PageHeader from '$lib/PageHeader.svelte';

  type Org = { id: string; name: string; status: string; admins: number; campaigns: number };
  let orgs = $state<Org[]>([]);
  let name = $state('');
  let error = $state('');

  async function load() {
    const r = await api<{ organisations: Org[] }>('/super/organisations');
    if (r.status === 403) return goto('/admin');
    if (r.ok) orgs = r.data.organisations;
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
<PageHeader title="Organisations" subtitle="Each organisation has its own admins and campaigns." />

<form onsubmit={create} class="card add">
  <label class="field" style="flex:1; margin:0">New organisation <input required minlength="2" bind:value={name} placeholder="e.g. DCIP Kozhikode" /></label>
  <button class="btn">Add organisation</button>
</form>
{#if error}<p class="error" role="alert">{error}</p>{/if}

<div class="card" style="padding:0; margin-top:16px">
  <div class="table-wrap">
    <table class="t">
      <thead><tr><th>Name</th><th>Admins</th><th>Campaigns</th><th>Status</th><th></th></tr></thead>
      <tbody>
        {#each orgs as o (o.id)}
          <tr>
            <td><strong>{o.name}</strong></td><td>{o.admins}</td><td>{o.campaigns}</td>
            <td><span class="badge {o.status}">{o.status}</span></td>
            <td style="text-align:right"><button class="sm" onclick={() => toggle(o)}>{o.status === 'active' ? 'Deactivate' : 'Activate'}</button></td>
          </tr>
        {:else}<tr><td colspan="5" class="empty">No organisations yet.</td></tr>{/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .add { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }
</style>
