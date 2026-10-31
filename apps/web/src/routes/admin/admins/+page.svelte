<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { showIst } from '$lib/time';
  import PageHeader from '$lib/PageHeader.svelte';

  type Admin = { id: string; name: string; email: string; role: string; status: string; orgName: string | null; lastLoginAt: string | null };
  type Org = { id: string; name: string; status: string };
  let admins = $state<Admin[]>([]);
  let orgs = $state<Org[]>([]);
  let form = $state({ name: '', email: '', mobile: '', orgId: '', role: 'manager' });
  let error = $state('');
  let adding = $state(false);
  let secret = $state<{ who: string; password: string } | null>(null);
  let copied = $state(false);

  async function copy() {
    try { await navigator.clipboard.writeText(secret!.password); copied = true; setTimeout(() => (copied = false), 2000); }
    catch { alert('Copy failed. Select the password and copy it manually.'); }
  }

  async function load() {
    const [a, o] = await Promise.all([api<{ admins: Admin[] }>('/super/admins'), api<{ organisations: Org[] }>('/super/organisations')]);
    if (a.status === 403) return goto('/admin');
    admins = a.data.admins ?? [];
    orgs = (o.data.organisations ?? []).filter((x) => x.status === 'active');
  }
  onMount(load);

  async function create(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    const r = await api<{ temporaryPassword?: string; error?: string }>('/super/admins', { method: 'POST', body: JSON.stringify({ ...form, mobile: form.mobile || undefined }) });
    if (!r.ok) { error = r.data.error === 'email_taken' ? 'That email already has an account.' : 'Check the details and try again.'; return; }
    secret = { who: form.email, password: r.data.temporaryPassword! };
    copied = false;
    form = { name: '', email: '', mobile: '', orgId: '', role: 'manager' };
    adding = false;
    await load();
  }

  async function act(a: Admin, action: 'suspend' | 'reactivate' | 'reset_password') {
    if (action === 'reset_password' && !confirm(`Reset the password for ${a.email}?`)) return;
    if (action === 'suspend' && !confirm(`Suspend ${a.email}? They will be signed out immediately.`)) return;
    const r = await api<{ temporaryPassword?: string }>(`/super/admins/${a.id}`, { method: 'PATCH', body: JSON.stringify({ action }) });
    if (r.data.temporaryPassword) { secret = { who: a.email, password: r.data.temporaryPassword }; copied = false; }
    await load();
  }
</script>

<svelte:head><title>Admins · InFrame</title></svelte:head>
<PageHeader title="Admins" subtitle="People who run campaigns for an organisation.">
  {#snippet actions()}<button class="btn" onclick={() => (adding = !adding)} disabled={orgs.length === 0}>{adding ? 'Cancel' : '+ New admin'}</button>{/snippet}
</PageHeader>

{#if secret}
  <div class="card secret" role="status">
    <strong>Temporary password for {secret.who}</strong>
    <p class="pw">{secret.password}</p>
    <p class="muted">Shown only once. Send it privately; they must change it at first sign-in.</p>
    <div class="row"><button class="btn" onclick={copy}>{copied ? 'Copied ✓' : 'Copy password'}</button><button onclick={() => (secret = null)}>Done</button></div>
  </div>
{/if}

{#if orgs.length === 0}
  <p class="card">Create an <a href="/admin/organisations">organisation</a> first.</p>
{/if}

{#if adding}
  <form onsubmit={create} class="card" style="margin-bottom:16px">
    <div class="g">
      <label class="field">Name <input required minlength="2" bind:value={form.name} /></label>
      <label class="field">Email <input type="email" required bind:value={form.email} /></label>
      <label class="field">Mobile <input bind:value={form.mobile} /></label>
      <label class="field">Organisation
        <select required bind:value={form.orgId}><option value="" disabled>Choose…</option>{#each orgs as o}<option value={o.id}>{o.name}</option>{/each}</select>
      </label>
      <label class="field">Role
        <select bind:value={form.role}><option value="manager">Campaign manager (full rights)</option><option value="viewer">Viewer (results only)</option></select>
      </label>
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="btn">Create admin</button>
  </form>
{/if}

<div class="card" style="padding:0">
  <div class="table-wrap">
    <table class="t">
      <thead><tr><th>Admin</th><th>Organisation</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
      <tbody>
        {#each admins as a (a.id)}
          <tr>
            <td><strong>{a.name}</strong><br /><small>{a.email}</small></td>
            <td>{a.orgName}</td><td>{a.role === 'manager' ? 'Manager' : 'Viewer'}</td>
            <td><span class="badge {a.status}">{a.status}</span></td>
            <td><small>{a.lastLoginAt ? showIst(a.lastLoginAt) : 'Never'}</small></td>
            <td class="acts">
              {#if a.status === 'suspended'}<button class="sm" onclick={() => act(a, 'reactivate')}>Reactivate</button>
              {:else}<button class="sm" onclick={() => act(a, 'suspend')}>Suspend</button>{/if}
              <button class="sm" onclick={() => act(a, 'reset_password')}>Reset password</button>
            </td>
          </tr>
        {:else}<tr><td colspan="6" class="empty">No admins yet.</td></tr>{/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .g { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0 16px; }
  .secret { background: var(--coral-50); border-color: #f4b8ad; margin-bottom: 16px; }
  .pw { font: 600 1.4rem monospace; margin: 8px 0; user-select: all; }
  .acts { display: flex; gap: 8px; justify-content: flex-end; white-space: nowrap; }
</style>
