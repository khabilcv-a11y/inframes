<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import { showIst } from '$lib/time';

  type P = { title: string; description: string | null; organisation: string; state: string; startsAt: string; endsAt: string; thankYou: string | null };
  let c = $state<P | null>(null);
  let missing = $state(false);

  onMount(async () => {
    const r = await api<P>(`/c/${page.params.code}`);
    if (r.ok) c = r.data; else missing = true;
  });

  const message: Record<string, string> = {
    scheduled: 'This campaign has not started yet.', paused: 'Back shortly.', ended: 'This campaign has ended. Thank you for taking part!'
  };
</script>

<svelte:head><title>{c?.title ?? 'Campaign'}</title></svelte:head>
<main style="padding: 48px 16px; max-width: 480px; margin: auto; text-align: center">
  {#if missing}
    <h1>Campaign not found</h1>
    <p>Check the link and try again.</p>
  {:else if c}
    <p><small>{c.organisation}</small></p>
    <h1>{c.title}</h1>
    {#if c.description}<p>{c.description}</p>{/if}
    {#if c.state === 'live'}
      <p>The photo frame editor is coming in the next update.</p>
    {:else}
      <p>{message[c.state]}</p>
      {#if c.state === 'scheduled'}<p>Starts {showIst(c.startsAt)}</p>{/if}
    {/if}
  {/if}
  <p style="margin-top:48px"><small><a href="/">Powered by InFrame</a></small></p>
</main>
