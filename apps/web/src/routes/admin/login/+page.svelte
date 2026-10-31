<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import Logo from '$lib/Logo.svelte';
  import Turnstile from '$lib/Turnstile.svelte';
  import { onMount } from 'svelte';
  import Viewfinder from '$lib/Viewfinder.svelte';

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);
  let siteKey = $state<string | null>(null);
  let botToken = $state('');
  let botReset = $state(0);
  onMount(async () => { const r = await api<{ turnstileSiteKey: string | null }>('/config'); if (r.ok) siteKey = r.data.turnstileSiteKey; });

  const messages: Record<string, string> = {
    invalid_credentials: 'Email or password is incorrect.',
    account_locked: 'Too many attempts. Try again in 15 minutes.',
    invalid_input: 'Enter a valid email and password.',
    bot_check_failed: 'Bot check failed. Please try again.'
  };

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    const r = await api<{ user?: { mustChangePassword: boolean }; error?: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, turnstileToken: botToken || undefined }) });
    botReset++;
    busy = false;
    if (!r.ok) { error = messages[r.data.error ?? ''] ?? 'Something went wrong. Try again.'; return; }
    session.user = null;
    await goto(r.data.user?.mustChangePassword ? '/admin/change-password' : '/admin');
  }
</script>

<svelte:head><title>Sign in · InFrame</title></svelte:head>
<div class="wrap">
  <section class="art" aria-hidden="true">
    <Logo size={34} dark />
    <Viewfinder class="frame"><div class="inner"><b>Be part of the picture.</b><span>Branded photo and video frames for every campaign.</span></div></Viewfinder>
  </section>
  <main>
    <form onsubmit={submit} class="card">
      <h1>Admin sign in</h1>
      <p class="muted">Use the email and password your super admin gave you.</p>
      <label class="field">Email <input type="email" autocomplete="username" required bind:value={email} /></label>
      <label class="field">Password <input type="password" autocomplete="current-password" required bind:value={password} /></label>
      <Turnstile {siteKey} bind:token={botToken} reset={botReset} />
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="btn block" disabled={busy || (!!siteKey && !botToken)}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <p style="margin:16px 0 0; text-align:center"><a href="/">← Back to home</a></p>
    </form>
  </main>
</div>

<style>
  .wrap { min-height: 100vh; display: grid; grid-template-columns: 1.1fr 1fr; }
  .art { background: var(--ink); padding: 32px; display: flex; flex-direction: column; justify-content: space-between; color: #fff; }
  :global(.frame) { padding: 48px 36px; max-width: 420px; }
  .inner { display: flex; flex-direction: column; gap: 12px; }
  .inner b { font: 700 clamp(2rem, 4vw, 3rem)/1.05 var(--display); letter-spacing: -0.03em; }
  .inner span { color: #b9b9c4; }
  main { display: grid; place-items: center; padding: 24px 16px; }
  form { width: 100%; max-width: 400px; }
  @media (max-width: 800px) { .wrap { grid-template-columns: 1fr; } .art { display: none; } }
</style>
