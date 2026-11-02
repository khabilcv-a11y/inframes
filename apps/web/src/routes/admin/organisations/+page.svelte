<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import PageHeader from '$lib/PageHeader.svelte';
  import LogoUpload from '$lib/LogoUpload.svelte';

  type Org = { id: string; name: string; status: string; admins: number; campaigns: number; logoUrl: string | null };
  const slug = (n: string) => n.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  let orgs = $state<Org[]>([]);
  let name = $state('');
  let editing = $state<string | null>(null);
  let editName = $state('');
  let editErr = $state('');
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
    const r = await api<{ error?: string }>('/super/organisations', { method: 'POST', body: JSON.stringify({ name }) });
    if (!r.ok) { error = r.data.error === 'name_taken' ? 'An organisation with this name already exists.' : 'Enter a name of at least 2 characters.'; return; }
    name = '';
    await load();
  }

  function startEdit(o: Org) { editing = o.id; editName = o.name; editErr = ''; }
  async function saveEdit(o: Org) {
    editErr = '';
    if (editName.trim() === o.name) { editing = null; return; }
    if (!confirm(`Rename “${o.name}” to “${editName.trim()}”?\n\nIts public page address changes, and new pictures saved to Google Drive go into a folder with the new name.`)) return;
    const r = await api<{ error?: string }>(`/super/organisations/${o.id}`, { method: 'PATCH', body: JSON.stringify({ name: editName }) });
    if (!r.ok) { editErr = r.data.error === 'name_taken' ? 'Another organisation already has this name.' : 'Enter a name of at least 2 characters.'; return; }
    editing = null;
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
      <thead><tr><th>Organisation</th><th>Logo</th><th>Admins</th><th>Campaigns</th><th>Status</th><th></th></tr></thead>
      <tbody>
        {#each orgs as o (o.id)}
          <tr>
            <td>
              {#if editing === o.id}
                <form class="edit" onsubmit={(e) => { e.preventDefault(); saveEdit(o); }}>
                  <input required minlength="2" bind:value={editName} aria-label="Organisation name" />
                  <button class="btn sm">Save</button>
                  <button type="button" class="sm" onclick={() => (editing = null)}>Cancel</button>
                </form>
                {#if editErr}<small class="error">{editErr}</small>{/if}
              {:else}
                <strong>{o.name}</strong><br /><small><a href={`/o/${slug(o.name)}`} target="_blank" rel="noopener">Public page ↗</a></small>
              {/if}
            </td>
            <td><LogoUpload endpoint={`/api/admin/organisations/${o.id}/logo`} bind:url={o.logoUrl} label="" /></td><td>{o.admins}</td><td>{o.campaigns}</td>
            <td><span class="badge {o.status}">{o.status}</span></td>
            <td class="acts"><button class="sm" onclick={() => startEdit(o)}>Edit</button> <button class="sm" onclick={() => toggle(o)}>{o.status === 'active' ? 'Deactivate' : 'Activate'}</button></td>
          </tr>
        {:else}<tr><td colspan="6" class="empty">No organisations yet.</td></tr>{/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .edit { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .edit input { margin: 0; min-height: 36px; width: 220px; }
  .acts { text-align: right; white-space: nowrap; }
  .add { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }
</style>
