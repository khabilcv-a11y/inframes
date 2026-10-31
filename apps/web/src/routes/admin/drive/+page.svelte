<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { showIst } from '$lib/time';
  import PageHeader from '$lib/PageHeader.svelte';

  type S = { configured: boolean; connected: boolean; email: string | null; connectedAt: string | null; quota: { used: number; limit: number | null } | null };
  let s = $state<S | null>(null);
  let copied = $state('');
  const redirect = $derived(`${location.origin}/api/drive/callback`);
  const gb = (n: number) => (n / 1e9 >= 100 ? `${(n / 1e12).toFixed(2)} TB` : `${(n / 1e9).toFixed(1)} GB`);
  const flash = page.url.searchParams;

  async function load() {
    const r = await api<S>('/super/drive/status');
    if (r.status === 403) return goto('/admin');
    if (r.ok) s = r.data;
  }
  onMount(load);

  async function disconnect() {
    if (!confirm('Disconnect Google Drive? New pictures will no longer be saved. Files already in Drive stay where they are.')) return;
    await api('/super/drive/disconnect', { method: 'POST' });
    await load();
  }
  async function copy(text: string, k: string) {
    try { await navigator.clipboard.writeText(text); copied = k; setTimeout(() => (copied = ''), 1800); } catch { /* ignore */ }
  }
  const errors: Record<string, string> = { denied: 'Google access was not allowed.', state: 'The connection link expired. Try again.', token: 'Google did not return a refresh token. Remove InFrame at myaccount.google.com/permissions and connect again.' };
</script>

<svelte:head><title>Google Drive · InFrame</title></svelte:head>
<PageHeader title="Google Drive" subtitle="Where participants' photos and finished pictures are saved." />

{#if flash.get('connected')}<p class="card ok" role="status">Google Drive is connected. ✓</p>{/if}
{#if flash.get('error')}<p class="card bad" role="alert">{errors[flash.get('error')!] ?? 'Could not connect.'}</p>{/if}

{#if s}
  {#if s.connected}
    <section class="card">
      <div class="row"><span class="badge active">Connected</span><strong>{s.email ?? 'Google account'}</strong></div>
      <p class="muted">Connected {s.connectedAt ? showIst(s.connectedAt) : ''}. Files go to <strong>InFrame / organisation / campaign</strong> folders in this Drive.</p>
      {#if s.quota}
        <p style="margin-bottom:6px">Storage used: <strong>{gb(s.quota.used)}</strong>{s.quota.limit ? ` of ${gb(s.quota.limit)}` : ''}</p>
        {#if s.quota.limit}<div class="bar"><i style="width:{Math.min(100, (s.quota.used / s.quota.limit) * 100)}%"></i></div>{/if}
      {/if}
      <div class="row" style="margin-top:16px"><a class="btn ghost sm" href="https://drive.google.com" target="_blank" rel="noopener">Open Google Drive ↗</a><button class="sm" onclick={disconnect}>Disconnect</button></div>
      <p class="muted" style="margin-top:16px"><small>Choose what is saved on each campaign's Overview tab → Edit details → Save to Google Drive.</small></p>
    </section>
  {:else if s.configured}
    <section class="card">
      <h2>Connect your Google Drive</h2>
      <p>Sign in with the Google account whose Drive should hold the files. InFrame can only see the files and folders it creates itself.</p>
      <a class="btn" href="/api/super/drive/connect">Connect Google Drive</a>
    </section>
  {:else}
    <section class="card">
      <h2>One-time setup needed</h2>
      <p>Google needs to trust this site before it can save files to your Drive. This takes about 10 minutes and is done once.</p>
      <ol class="steps">
        <li>Open <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">Google Cloud Console</a> (signed in with the Drive account) and create a project called <b>InFrame</b>.</li>
        <li>Go to <b>APIs &amp; Services → Library</b>, search <b>Google Drive API</b> and click <b>Enable</b>.</li>
        <li>Go to <b>Google Auth Platform</b> (or OAuth consent screen) → set up: app name <b>InFrame</b>, your email, audience <b>External</b>. Under <b>Audience → Test users</b>, add your own Gmail. Click <b>Publish app</b> later so the connection does not expire after 7 days.</li>
        <li>Go to <b>Clients → Create client</b> → type <b>Web application</b>. Under <b>Authorised redirect URIs</b> add:
          <div class="copy"><code>{redirect}</code><button class="sm" onclick={() => copy(redirect, 'r')}>{copied === 'r' ? 'Copied ✓' : 'Copy'}</button></div></li>
        <li>Copy the <b>Client ID</b> and <b>Client secret</b>. In Cloudflare, open the Pages project → Settings → Variables and Secrets and add: <code>GOOGLE_CLIENT_ID</code> (variable), <code>GOOGLE_CLIENT_SECRET</code> (secret) and <code>TOKEN_ENC_KEY</code> (secret, any long random text of 32+ characters). Then retry the latest deployment.</li>
        <li>Come back to this page and click <b>Connect Google Drive</b>.</li>
      </ol>
    </section>
  {/if}
{:else}<p class="muted">Loading…</p>{/if}

<style>
  .ok { background: var(--ok-bg); border-color: #b9e0c8; color: var(--ok); font-weight: 600; margin-bottom: 16px; }
  .bad { background: var(--bad-bg); border-color: #efc5c2; color: var(--bad); font-weight: 600; margin-bottom: 16px; }
  .bar { height: 10px; background: #eeeee9; border-radius: 99px; overflow: hidden; max-width: 420px; }
  .bar i { display: block; height: 100%; background: var(--coral); }
  .steps { padding-left: 20px; display: grid; gap: 12px; }
  code { background: #f1f1ec; padding: 2px 6px; border-radius: 6px; font-size: .85rem; overflow-wrap: anywhere; }
  .copy { display: flex; gap: 8px; align-items: center; margin-top: 6px; flex-wrap: wrap; }
</style>
