<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import { MIN_PASSWORD_LENGTH } from '@inframe/shared';
  import Logo from '$lib/Logo.svelte';

  let currentPassword = $state('');
  let newPassword = $state('');
  let error = $state('');

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    const r = await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
    if (r.ok) { session.user = null; await goto('/admin'); }
    else if (r.status === 401) error = 'Current password is incorrect.';
    else if (r.status === 400) error = `New password must be at least ${MIN_PASSWORD_LENGTH} characters and different from the current one.`;
    else await goto('/admin/login');
  }
</script>

<svelte:head><title>Set a new password · InFrame</title></svelte:head>
<main>
  <form onsubmit={submit} class="card">
    <Logo size={26} />
    <h1 style="margin-top:20px">Set a new password</h1>
    <p class="muted">For your security, choose your own password before continuing.</p>
    <label class="field">Current (temporary) password <input type="password" autocomplete="current-password" required bind:value={currentPassword} /></label>
    <label class="field">New password <input type="password" autocomplete="new-password" required minlength={MIN_PASSWORD_LENGTH} bind:value={newPassword} /><span class="hint">At least {MIN_PASSWORD_LENGTH} characters.</span></label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="btn block">Save password</button>
  </form>
</main>

<style>
  main { min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; }
  form { width: 100%; max-width: 420px; }
</style>
