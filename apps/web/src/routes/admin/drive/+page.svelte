<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { showIst } from '$lib/time';
  import PageHeader from '$lib/PageHeader.svelte';

  type S = { connected: boolean; email: string | null; connectedAt: string | null };
  let s = $state<S | null>(null);
  let script = $state('');
  let url = $state('');
  let msg = $state('');
  let err = $state('');
  let busy = $state(false);
  let copied = $state(false);

  async function load() {
    const r = await api<S>('/super/drive/status');
    if (r.status === 403) return goto('/admin');
    if (r.ok) s = r.data;
    if (r.ok && !r.data.connected) { const sc = await api<{ script: string }>('/super/drive/script'); if (sc.ok) script = sc.data.script; }
  }
  onMount(load);

  async function copy() {
    try { await navigator.clipboard.writeText(script); copied = true; setTimeout(() => (copied = false), 2000); } catch { err = 'Copy failed. Select the text in the box and copy it manually.'; }
  }
  async function connect(e: SubmitEvent) {
    e.preventDefault();
    err = ''; busy = true;
    const r = await api<{ error?: string }>('/super/drive/connect', { method: 'POST', body: JSON.stringify({ url }) });
    busy = false;
    if (r.ok) { msg = 'Google Drive is connected. ✓'; url = ''; await load(); return; }
    err = r.data.error === 'bad_url' ? 'That does not look like the Web app URL. It starts with https://script.google.com/macros/s/ and ends with /exec.'
      : 'Could not reach your script. Check that you pasted the script exactly as shown, deployed it as a Web app with access set to “Anyone”, and copied the Web app URL (not the editor address).';
  }
  async function test() {
    msg = ''; err = ''; busy = true;
    const r = await api<{ ok?: boolean }>('/super/drive/test', { method: 'POST' });
    busy = false;
    if (r.data.ok) msg = 'Working. ✓'; else err = 'The script did not answer. Open it in Google, deploy it again as a Web app, and reconnect.';
  }
  async function disconnect() {
    if (!confirm('Disconnect Google Drive? New pictures will no longer be saved. Files already in Drive stay where they are.')) return;
    await api('/super/drive/disconnect', { method: 'POST' });
    msg = ''; await load();
  }
</script>

<svelte:head><title>Google Drive · InFrame</title></svelte:head>
<PageHeader title="Google Drive" subtitle="Save participants' photos and finished pictures to your own Drive." />

{#if msg}<p class="card ok" role="status">{msg}</p>{/if}
{#if err}<p class="card bad" role="alert">{err}</p>{/if}

{#if s?.connected}
  <section class="card">
    <div class="row"><span class="badge active">Connected</span><strong>{s.email ?? 'Your Google account'}</strong></div>
    <p class="muted">Connected {s.connectedAt ? showIst(s.connectedAt) : ''}. Pictures are saved in your Drive under <strong>InFrame → organisation → campaign</strong>.</p>
    <div class="row">
      <a class="btn ghost sm" href="https://drive.google.com" target="_blank" rel="noopener">Open Google Drive ↗</a>
      <button class="sm" onclick={test} disabled={busy}>Test</button>
      <button class="sm" onclick={disconnect}>Disconnect</button>
    </div>
    <p class="muted" style="margin-top:16px"><small>Choose what to save on each campaign: Campaigns → the campaign → Edit details → Save to Google Drive.</small></p>
  </section>
{:else if s}
  <section class="card">
    <h2>Connect in 5 steps (about 3 minutes)</h2>
    <p class="muted">This uses a tiny script that lives in <strong>your own Google account</strong>. No developer console or keys are needed.</p>
    <ol class="steps">
      <li>Open <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">script.google.com</a>, signed in with the Google account whose Drive you want to use. A new project opens.</li>
      <li>Select all the sample code in the editor, delete it, and paste this script:
        <div class="row" style="margin:8px 0"><button class="btn sm" onclick={copy}>{copied ? 'Copied ✓' : 'Copy script'}</button></div>
        <textarea readonly rows="6" value={script} onfocus={(e) => e.currentTarget.select()}></textarea>
      </li>
      <li>Click <b>Deploy → New deployment</b>. Click the gear next to “Select type” and choose <b>Web app</b>. Set <b>Execute as: Me</b> and <b>Who has access: Anyone</b>, then click <b>Deploy</b>.</li>
      <li>Click <b>Authorize access</b> and choose your account. If Google says it hasn’t verified the app, click <b>Advanced → Go to … (unsafe) → Allow</b>. This warning appears for every personal script; it is your own script.</li>
      <li>Copy the <b>Web app URL</b> and paste it here:
        <form onsubmit={connect} class="row" style="margin-top:8px; align-items:flex-start">
          <input style="flex:1; min-width:240px; margin:0" required placeholder="https://script.google.com/macros/s/…/exec" bind:value={url} />
          <button class="btn" disabled={busy}>{busy ? 'Checking…' : 'Connect'}</button>
        </form>
      </li>
    </ol>
    <p class="muted"><small>“Anyone” only means the link opens without a login. Every request must carry a signed ticket from this site, so nobody else can use it.</small></p>
  </section>
{:else}<p class="muted">Loading…</p>{/if}

<style>
  .ok { background: var(--ok-bg); border-color: #b9e0c8; color: var(--ok); font-weight: 600; margin-bottom: 16px; }
  .bad { background: var(--bad-bg); border-color: #efc5c2; color: var(--bad); font-weight: 600; margin-bottom: 16px; }
  .steps { padding-left: 20px; display: grid; gap: 16px; }
  textarea { font: .78rem/1.4 monospace; min-height: 0; }
</style>
