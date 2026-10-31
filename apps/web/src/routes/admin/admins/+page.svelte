<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';

  type Admin = { id: string; name: string; email: string; role: string; status: string; orgName: string | null; lastLoginAt: string | null };
  type Org = { id: string; name: string; status: string };
  let admins = $state<Admin[]>([]);
  let orgs = $state<Org[]>([]);
  let form = $state({ name: '', email: '', mobile: '', orgId: '', role: 'manager' });
  let error = $state('');
  let secret = $state<{ who: string; password: string } | null>(null);
  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret!.password);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      alert('Copy failed. Select the password and copy it manually.');
    }
  }

  async function load() {
    const [a, o] = await Promise.all([
      api<{ admins: Admin[] }>('/super/admins'),
      api<{ organisations: Org[] }>('/super/organisations')
    ]);
    if (a.status === 401) return goto('/admin/login');
    if (a.status === 403) return goto('/admin');
    admins = a.data.admins;
    orgs = o.data.organisations.filter((x) => x.status === 'active');
  }
  onMount(load);

  async function create(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    const r = await api<{ temporaryPassword?: string; error?: string }>('/super/admins', {
      method: 'POST',
      body: JSON.stringify({ ...form, mobile: form.mobile || undefined })
    });
    if (!r.ok) { error = r.data.error === 'email_taken' ? 'That email already has an account.' : 'Check the details and try again.'; return; }
    secret = { who: form.email, password: r.data.temporaryPassword! };
    copied = false;
    form = { name: '', email: '', mobile: '', orgId: '', role: 'manager' };
    await load();
  }

  async function act(a: Admin, action: 'suspend' | 'reactivate' | 'reset_password') {
    if (action === 'reset_password' && !confirm(`Reset the password for ${a.email}?`)) return;
    const r = await api<{ temporaryPassword?: string }>(`/super/admins/${a.id}`, { method: 'PATCH', body: JSON.stringify({ action }) });
    if (r.data.temporaryPassword) { secret = { who: a.email, password: r.data.temporaryPassword }; copied = false; }
    await load();
  }
</script>

<svelte:head><title>Admins · InFrame</title></svelte:head>
<main style="padding: 32px 16px; max-width: 900px; margin: auto">
  <p><a href="/admin">← Back</a></p>
  <h1>Admins</h1>

  {#if secret}
    <div role="status" style="background:#fff3ef; border:1px solid var(--coral); border-radius:10px; padding:16px; margin-bottom:24px">
      <strong>Temporary password for {secret.who}</strong>
      <p style="font: 20px monospace; margin:8px 0">{secret.password}</p>
      <p>Shown only once. Send it to them privately; they must change it at first sign-in.</p>
      <button class="btn" onclick={copy}>{copied ? 'Copied ✓' : 'Copy password'}</button>
      <button onclick={() => (secret = null)}>Done</button>
    </div>
  {/if}

  {#if orgs.length === 0}
    <p>Create an <a href="/admin/organisations">organisation</a> first.</p>
  {:else}
    <form onsubmit={create} style="display:grid; gap:8px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); align-items:end">
      <label class="field" style="margin:0">Name <input required minlength="2" bind:value={form.name} /></label>
      <label class="field" style="margin:0">Email <input type="email" required bind:value={form.email} /></label>
      <label class="field" style="margin:0">Mobile <input bind:value={form.mobile} /></label>
      <label class="field" style="margin:0">Organisation
        <select required bind:value={form.orgId} style="width:100%; min-height:48px"><option value="" disabled>Choose…</option>{#each orgs as o}<option value={o.id}>{o.name}</option>{/each}</select>
      </label>
      <label class="field" style="margin:0">Role
        <select bind:value={form.role} style="width:100%; min-height:48px"><option value="manager">Campaign manager</option><option value="viewer">Viewer (metrics only)</option></select>
      </label>
      <button class="btn">Create admin</button>
    </form>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {/if}

  <table style="width:100%; margin-top:24px; border-collapse:collapse">
    <thead><tr style="text-align:left"><th>Name</th><th>Organisation</th><th>Role</th><th>Status</th><th>Last login</th><th></th></tr></thead>
    <tbody>
      {#each admins as a (a.id)}
        <tr style="border-top:1px solid #e3e3de">
          <td>{a.name}<br /><small>{a.email}</small></td><td>{a.orgName}</td><td>{a.role}</td><td>{a.status}</td>
          <td>{a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : '—'}</td>
          <td>
            {#if a.status === 'suspended'}<button onclick={() => act(a, 'reactivate')}>Reactivate</button>
            {:else}<button onclick={() => act(a, 'suspend')}>Suspend</button>{/if}
            <button onclick={() => act(a, 'reset_password')}>Reset password</button>
          </td>
        </tr>
      {:else}
        <tr><td colspan="6">No admins yet.</td></tr>
      {/each}
    </tbody>
  </table>
</main>
