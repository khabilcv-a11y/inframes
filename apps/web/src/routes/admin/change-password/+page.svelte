<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { MIN_PASSWORD_LENGTH } from '@inframe/shared';

  let currentPassword = $state('');
  let newPassword = $state('');
  let error = $state('');

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    const r = await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
    if (r.ok) await goto('/admin');
    else if (r.status === 401) error = 'Current password is incorrect.';
    else if (r.status === 400) error = `New password must be at least ${MIN_PASSWORD_LENGTH} characters and different from the current one.`;
    else await goto('/admin/login');
  }
</script>

<svelte:head><title>Set a new password · InFrame</title></svelte:head>
<main style="padding: 48px 16px; max-width: 400px; margin: auto">
  <h1>Set a new password</h1>
  <form onsubmit={submit}>
    <label class="field">Current password <input type="password" autocomplete="current-password" required bind:value={currentPassword} /></label>
    <label class="field">New password <input type="password" autocomplete="new-password" required minlength={MIN_PASSWORD_LENGTH} bind:value={newPassword} /></label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="btn">Save password</button>
  </form>
</main>
