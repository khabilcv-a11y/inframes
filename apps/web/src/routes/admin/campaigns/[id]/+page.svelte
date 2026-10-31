<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { showIst } from '$lib/time';
  import CampaignForm from '$lib/CampaignForm.svelte';

  type C = { id: string; title: string; orgName: string; shortCode: string; state: string; startsAt: string; endsAt: string;
    description: string | null; language: string; caption: string | null; hashtags: string | null; thankYou: string | null; ctaUrl: string | null };
  let c = $state<C | null>(null);
  let editing = $state(false);
  let error = $state('');
  let copied = $state(false);
  const id = page.params.id;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      alert('Copy failed. Select the link and copy it manually.');
    }
  }

  async function load() {
    const r = await api<{ campaign: C }>(`/admin/campaigns/${id}`);
    if (r.status === 401) return goto('/admin/login');
    if (!r.ok) return goto('/admin/campaigns');
    c = r.data.campaign;
  }
  onMount(load);

  const actions: Record<string, [string, string][]> = {
    draft: [['publish', 'Publish']], scheduled: [['pause', 'Pause'], ['end', 'End now']], live: [['pause', 'Pause'], ['end', 'End now']],
    paused: [['resume', 'Resume'], ['end', 'End now']], ended: [['archive', 'Archive']]
  };

  async function act(action: string) {
    if (action === 'end' && !confirm('End this campaign now? People will no longer be able to use it.')) return;
    const r = await api(`/admin/campaigns/${id}/state`, { method: 'POST', body: JSON.stringify({ action }) });
    if (!r.ok) alert('That is not possible right now.');
    await load();
  }

  async function save(payload: Record<string, unknown>) {
    error = '';
    const { orgId: _o, ...rest } = payload;
    const r = await api(`/admin/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(rest) });
    if (!r.ok) { error = 'Check the details. The end time must be after the start.'; return; }
    editing = false;
    await load();
  }

  const link = $derived(c ? `${location.origin}/c/${c.shortCode}` : '');
</script>

<svelte:head><title>{c?.title ?? 'Campaign'} · InFrame</title></svelte:head>
<main style="padding: 32px 16px; max-width: 560px; margin: auto">
  <p><a href="/admin/campaigns">← Campaigns</a></p>
  {#if c}
    <h1>{c.title}</h1>
    <p><strong>{c.state.toUpperCase()}</strong> · {c.orgName}<br />
      <small>{showIst(c.startsAt)} → {showIst(c.endsAt)} (India time)</small></p>
    {#if c.state === 'draft'}
      <p>Participant link (works after you publish): <strong>{link}</strong></p>
    {:else}
      <p>Participant link: <a href={link}>{link}</a></p>
    {/if}
    <p><button onclick={copyLink}>{copied ? 'Copied ✓' : 'Copy link'}</button></p>
    <p style="display:flex; gap:8px; flex-wrap:wrap">
      {#each actions[c.state] ?? [] as [a, label]}<button class="btn" onclick={() => act(a)}>{label}</button>{/each}
      {#if !editing && c.state !== 'archived'}<button onclick={() => (editing = true)}>Edit details</button>{/if}
    </p>
    {#if editing}
      <CampaignForm initial={c} submitLabel="Save changes" onsubmit={save} {error} />
    {/if}
  {/if}
</main>
