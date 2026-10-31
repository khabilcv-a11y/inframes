<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, getMe } from '$lib/api';
  import CampaignForm from '$lib/CampaignForm.svelte';

  let orgs = $state<{ id: string; name: string }[]>([]);
  let ready = $state(false);
  let error = $state('');

  onMount(async () => {
    const me = await getMe();
    if (!me.ok) return goto('/admin/login');
    if (me.data.user.role === 'viewer') return goto('/admin');
    if (me.data.user.role === 'super_admin') {
      const o = await api<{ organisations: { id: string; name: string; status: string }[] }>('/super/organisations');
      orgs = o.data.organisations.filter((x) => x.status === 'active');
    }
    ready = true;
  });

  async function create(payload: Record<string, unknown>) {
    error = '';
    const r = await api<{ id?: string; error?: string }>('/admin/campaigns', { method: 'POST', body: JSON.stringify(payload) });
    if (r.ok) return goto(`/admin/campaigns/${r.data.id}`);
    error = r.data.error === 'code_taken' ? 'That link code is already used.' : 'Check the details. The end time must be after the start.';
  }
</script>

<svelte:head><title>New campaign · InFrame</title></svelte:head>
<main style="padding: 32px 16px; max-width: 560px; margin: auto">
  <p><a href="/admin/campaigns">← Campaigns</a></p>
  <h1>New campaign</h1>
  {#if ready}<CampaignForm {orgs} submitLabel="Save as draft" onsubmit={create} {error} />{/if}
</main>
