<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, getMe } from '$lib/api';
  import type { SessionUser } from '@inframe/shared';

  let user = $state<SessionUser | null>(null);

  onMount(async () => {
    const r = await getMe();
    if (!r.ok) return goto('/admin/login');
    if (r.data.user.mustChangePassword) return goto('/admin/change-password');
    user = r.data.user;
  });

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    await goto('/admin/login');
  }
</script>

<svelte:head><title>Admin · InFrame</title></svelte:head>
<main style="padding: 48px 16px; max-width: 720px; margin: auto">
  {#if user}
    <h1>Hello, {user.name}</h1>
    <p>Signed in as {user.email} ({user.role.replace('_', ' ')}). Campaigns arrive next.</p>
    <p><a href="/admin/campaigns">Campaigns</a></p>
    {#if user.role === 'super_admin'}
      <p><a href="/admin/organisations">Organisations</a> · <a href="/admin/admins">Admins</a></p>
    {/if}
    <button class="btn" onclick={logout}>Sign out</button>
  {/if}
</main>
