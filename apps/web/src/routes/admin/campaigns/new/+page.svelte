<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import CampaignForm from '$lib/CampaignForm.svelte';
  import PageHeader from '$lib/PageHeader.svelte';

  let orgs = $state<{ id: string; name: string }[]>([]);
  let ready = $state(false);
  let error = $state('');

  onMount(async () => {
    if (session.user?.role === 'viewer') return goto('/admin');
    if (session.user?.role === 'super_admin') {
      const o = await api<{ organisations: { id: string; name: string; status: string }[] }>('/super/organisations');
      orgs = o.data.organisations.filter((x) => x.status === 'active');
    }
    ready = true;
  });

  async function create(payload: Record<string, unknown>) {
    error = '';
    const r = await api<{ id?: string; error?: string }>('/admin/campaigns', { method: 'POST', body: JSON.stringify(payload) });
    if (r.ok) return goto(`/admin/campaigns/${r.data.id}/frames`);
    error = r.data.error === 'code_taken' ? 'That link code is already used.' : 'Check the details. The end time must be after the start.';
  }
</script>

<svelte:head><title>New campaign · InFrame</title></svelte:head>
<PageHeader title="New campaign" subtitle="Step 1 of 3: details and schedule. Next you will add your frame." back="Campaigns" backHref="/admin/campaigns" />
{#if ready}
  <div class="card" style="max-width:640px"><CampaignForm {orgs} submitLabel="Save and add frame →" onsubmit={create} {error} /></div>
{/if}
