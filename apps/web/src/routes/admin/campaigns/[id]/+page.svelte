<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import QRCode from 'qrcode';
  import { api } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import { current, loadCampaign } from '$lib/campaign.svelte';
  import CampaignForm from '$lib/CampaignForm.svelte';
  import { makePosterPdf } from '$lib/poster';
  import LogoUpload from '$lib/LogoUpload.svelte';

  const id = page.params.id!;
  let frames = $state(0);
  let boxes = $state(0);
  let editing = $state(false);
  let error = $state('');
  let copied = $state(false);
  let campLogo = $state<string | null>(null);
  let orgLogo = $state<string | null>(null);
  let qr = $state('');
  const canEdit = $derived(session.user?.role !== 'viewer');
  const c = $derived(current.c!);
  const link = $derived(`${location.origin}/c/${c.shortCode}`);

  async function loadFrames() {
    const r = await api<{ templates: { slots: unknown[] }[] }>(`/admin/campaigns/${id}/templates`);
    if (r.ok) { frames = r.data.templates.length; boxes = r.data.templates.reduce((n, t) => n + t.slots.length, 0); }
  }
  onMount(async () => {
    loadFrames();
    const r = await api<{ campaign: { ownLogo: boolean; logoUrl: string | null; orgLogoUrl: string | null } }>(`/admin/campaigns/${id}`);
    if (r.ok) { campLogo = r.data.campaign.ownLogo ? r.data.campaign.logoUrl : null; orgLogo = r.data.campaign.orgLogoUrl; }
  });
  $effect(() => { if (c) QRCode.toDataURL(link, { margin: 1, width: 360, color: { dark: '#16161A', light: '#FFFFFF' } }).then((u) => (qr = u)); });

  const actions: Record<string, [string, string, string][]> = {
    draft: [['publish', 'Publish campaign', 'btn']],
    scheduled: [['pause', 'Pause', 'btn ghost'], ['end', 'End now', 'btn danger']],
    live: [['pause', 'Pause', 'btn ghost'], ['end', 'End now', 'btn danger']],
    paused: [['resume', 'Resume', 'btn'], ['end', 'End now', 'btn danger']],
    ended: [['archive', 'Archive', 'btn ghost']]
  };

  async function act(action: string) {
    if (action === 'end' && !confirm('End this campaign now? People will no longer be able to create frames.')) return;
    const r = await api(`/admin/campaigns/${id}/state`, { method: 'POST', body: JSON.stringify({ action }) });
    if (!r.ok) alert('That is not possible right now.');
    await loadCampaign(id);
  }

  async function save(payload: Record<string, unknown>) {
    error = '';
    const { orgId: _o, ...rest } = payload;
    const r = await api(`/admin/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(rest) });
    if (!r.ok) { error = r.status === 409 ? 'That link code is already used.' : 'Check the details. The end time must be after the start.'; return; }
    editing = false;
    await loadCampaign(id);
  }

  let posterBusy = $state(false);
  async function poster() {
    posterBusy = true;
    try {
      const blob = await makePosterPdf({ organisation: c.orgName, title: c.title, description: c.description, link, hashtags: c.hashtags, lang: c.language as 'en' | 'ml' | 'hi' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${c.shortCode}-poster.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch { alert('Could not make the poster. Try again.'); }
    posterBusy = false;
  }

  async function copy() {
    try { await navigator.clipboard.writeText(link); copied = true; setTimeout(() => (copied = false), 2000); } catch { alert('Copy failed. Select the link and copy it manually.'); }
  }

  const ready = $derived([
    { ok: frames > 0, text: 'Add a frame', href: `/admin/campaigns/${id}/frames` },
    { ok: boxes > 0, text: 'Add title boxes (name, college)', href: `/admin/campaigns/${id}/frames` },
    { ok: !!c?.caption, text: 'Write a caption', href: '' },
    { ok: c?.state !== 'draft', text: 'Publish', href: '' }
  ]);
</script>

<div class="two">
  <div class="grid">
    {#if c.state === 'draft' && canEdit}
      <section class="card">
        <h2>Get ready to launch</h2>
        <ul class="check">
          {#each ready as r}
            <li class:done={r.ok}><span class="tick">{r.ok ? '✓' : ''}</span>{#if r.href && !r.ok}<a href={r.href}>{r.text}</a>{:else}{r.text}{/if}</li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if canEdit}
      <section class="card">
        <h2>Actions</h2>
        <div class="row">
          {#each actions[c.state] ?? [] as [a, label, cls]}<button class={cls} onclick={() => act(a)}>{label}</button>{/each}
          <a class="btn ghost" href={`${link}?preview=1`} target="_blank" rel="noopener">Test as participant ↗</a>
          {#if c.state !== 'archived'}<button class="ghost" onclick={() => (editing = !editing)}>{editing ? 'Close editor' : 'Edit details'}</button>{/if}
        </div>
        {#if c.state === 'draft'}<p class="muted" style="margin:12px 0 0"><small>Testing does not count in your numbers.</small></p>{/if}
      </section>
    {/if}

    {#if canEdit}
      <section class="card">
        <h2>Logos</h2>
        <p class="muted" style="margin-top:-4px"><small>Shown on the campaign page and its cards. A campaign without its own logo uses the organisation's.</small></p>
        <div class="grid" style="gap:16px">
          <LogoUpload endpoint={`/api/admin/campaigns/${id}/logo`} bind:url={campLogo} label="Campaign logo (optional)" />
          <LogoUpload endpoint={`/api/admin/organisations/${c.orgId}/logo`} bind:url={orgLogo} label={`${c.orgName} logo`} />
        </div>
      </section>
    {/if}

    {#if editing}
      <section class="card"><h2>Edit details</h2><CampaignForm initial={c} submitLabel="Save changes" onsubmit={save} {error} /></section>
    {:else}
      <section class="card">
        <h2>Details</h2>
        <dl>
          <dt>Link code</dt><dd>/c/{c.shortCode}</dd>
          <dt>Page language</dt><dd>{{ en: 'English', ml: 'മലയാളം', hi: 'हिन्दी' }[c.language]}</dd>
          <dt>Description</dt><dd>{c.description || '—'}</dd>
          <dt>Caption</dt><dd>{c.caption || '—'}</dd>
          <dt>Hashtags</dt><dd>{c.hashtags || '—'}</dd>
          <dt>Thank-you</dt><dd>{c.thankYou || '—'}</dd>
          <dt>Saved to Drive</dt><dd>{({ off: 'Nothing', raw: 'Original photos', framed: 'Finished pictures', both: 'Original photos and finished pictures' } as Record<string, string>)[c.saveMode ?? 'off']}</dd>
          <dt>Call-to-action</dt><dd>{c.ctaUrl || 'This campaign’s own link'}</dd>
        </dl>
      </section>
    {/if}
  </div>

  <aside class="card share">
    <h2>Share</h2>
    <p class="muted" style="margin-bottom:8px">{c.state === 'draft' ? 'Works once you publish.' : 'Anyone with this link can take part.'}</p>
    <div class="linkbox">{link}</div>
    <div class="row" style="margin:12px 0">
      <button class="sm" onclick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</button>
      {#if qr}<a class="btn ghost sm" href={qr} download={`${c.shortCode}-qr.png`}>Download QR</a>{/if}
    </div>
    <button class="sm block" onclick={poster} disabled={posterBusy} style="width:100%; margin-bottom:12px">{posterBusy ? 'Making poster…' : 'Download poster (A4 PDF)'}</button>
    {#if qr}<img src={qr} alt="QR code for the campaign link" width="180" height="180" />{/if}
  </aside>
</div>

<style>
  .two { display: grid; grid-template-columns: 1fr 300px; gap: 20px; align-items: start; }
  @media (max-width: 900px) { .two { grid-template-columns: 1fr; } }
  .check { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .check li { display: flex; gap: 12px; align-items: center; }
  .tick { width: 24px; height: 24px; border-radius: 50%; border: 2px solid #cfcfc8; display: grid; place-items: center; font-size: .8rem; color: #fff; }
  .done .tick { background: var(--ok); border-color: var(--ok); }
  .done { color: var(--muted); text-decoration: line-through; }
  dl { display: grid; grid-template-columns: 130px 1fr; gap: 10px 16px; margin: 0; }
  dt { color: var(--muted); font-size: .9rem; }
  dd { margin: 0; overflow-wrap: anywhere; }
  .linkbox { background: #f3f3ee; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; font: 500 .88rem monospace; overflow-wrap: anywhere; }
  .share img { display: block; margin-top: 8px; border: 1px solid var(--line); border-radius: 10px; }
</style>
