<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);

  const messages: Record<string, string> = {
    invalid_credentials: 'Email or password is incorrect.',
    account_locked: 'Too many attempts. Try again in 15 minutes.',
    invalid_input: 'Enter a valid email and password.'
  };

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    const r = await api<{ user?: { mustChangePassword: boolean }; error?: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    busy = false;
    if (!r.ok) {
      error = messages[r.data.error ?? ''] ?? 'Something went wrong. Try again.';
      return;
    }
    await goto(r.data.user?.mustChangePassword ? '/admin/change-password' : '/admin');
  }
</script>

<svelte:head><title>Admin login · InFrame</title></svelte:head>
<main style="padding: 48px 16px; max-width: 400px; margin: auto">
  <h1>Admin login</h1>
  <form onsubmit={submit}>
    <label class="field">Email <input type="email" autocomplete="username" required bind:value={email} /></label>
    <label class="field">Password <input type="password" autocomplete="current-password" required bind:value={password} /></label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
  </form>
</main>
