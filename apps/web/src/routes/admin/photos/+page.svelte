<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import PageHeader from '$lib/PageHeader.svelte';

  type C = { id: string; title: string; orgName: string; shortCode: string; state: string };
  let list = $state<(C & { photos: number | null })[]>([]);
  let loaded = $state(false);

  onMount(async () => {
    const r = await api<{ campaigns: C[] }>('/admin/campaigns');
    if (r.ok) list = r.data.campaigns.filter((c) => c.state !== 'archived').map((c) => ({ ...c, photos: null }));
    loaded = true;
    // photo counts arrive after the list is shown
    for (const c of list) api<{ total: number }>(`/admin/campaigns/${c.id}/photos`).then((x) => { if (x.ok) c.photos = x.data.total; });
  });
</script>

<svelte:head><title>Event photos · InFrame</title></svelte:head>
<PageHeader title="Event photos" subtitle="Add an event's pictures to a campaign. People then find their own photos with a selfie." />
<p class="badge draft" style="margin-bottom:16px">Beta</p>

<div class="card" style="padding:0">
  {#each list as c (c.id)}
    <div class="item">
      <div><strong>{c.title}</strong><br /><small>{c.orgName} · <span class="badge {c.state}">{c.state}</span></small></div>
      <span class="spacer"></span>
      <small class="muted">{c.photos === null ? '' : `${c.photos} photo${c.photos === 1 ? '' : 's'}`}</small>
      <a class="btn sm" href={`/admin/campaigns/${c.id}/photos`}>{c.photos ? 'Manage photos' : 'Add photos'}</a>
    </div>
  {:else}
    <div class="empty">{loaded ? 'Create a campaign first, then add its event photos here.' : 'Loading…'}</div>
  {/each}
</div>

<style>
  .item { display: flex; align-items: center; gap: 16px; padding: 14px 20px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .item:last-child { border-bottom: 0; }
</style>
