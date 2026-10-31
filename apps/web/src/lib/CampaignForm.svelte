<script lang="ts">
  import { istInputToIso, isoToIstInput } from '$lib/time';

  type Initial = {
    title?: string; description?: string | null; language?: string; startsAt?: string; endsAt?: string;
    caption?: string | null; hashtags?: string | null; thankYou?: string | null; ctaUrl?: string | null; shortCode?: string; saveMode?: string;
  };
  let { initial = {}, orgs = [], submitLabel, onsubmit, error = '' }: {
    initial?: Initial; orgs?: { id: string; name: string }[]; submitLabel: string;
    onsubmit: (payload: Record<string, unknown>) => void; error?: string;
  } = $props();

  let f = $state({
    title: initial.title ?? '', description: initial.description ?? '', language: initial.language ?? 'en',
    startsAt: initial.startsAt ? isoToIstInput(initial.startsAt) : '', endsAt: initial.endsAt ? isoToIstInput(initial.endsAt) : '',
    caption: initial.caption ?? '', hashtags: initial.hashtags ?? '', thankYou: initial.thankYou ?? '',
    ctaUrl: initial.ctaUrl ?? '', shortCode: initial.shortCode ?? '', orgId: '', saveMode: initial.saveMode ?? 'off'
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const clean = (v: string) => (v.trim() ? v.trim() : undefined);
    onsubmit({
      title: f.title, description: clean(f.description), language: f.language,
      startsAt: istInputToIso(f.startsAt), endsAt: istInputToIso(f.endsAt),
      caption: clean(f.caption), hashtags: clean(f.hashtags), thankYou: clean(f.thankYou), ctaUrl: clean(f.ctaUrl),
      shortCode: clean(f.shortCode)?.toLowerCase(), orgId: clean(f.orgId), saveMode: f.saveMode
    });
  }
</script>

<form onsubmit={submit}>
  <h2>Basics</h2>
  {#if orgs.length}
    <label class="field">Organisation
      <select required bind:value={f.orgId} style="width:100%; min-height:48px"><option value="" disabled>Choose…</option>{#each orgs as o}<option value={o.id}>{o.name}</option>{/each}</select>
    </label>
  {/if}
  <label class="field">Title <input required minlength="2" bind:value={f.title} placeholder="Special Enrolment Drive" /></label>
  <label class="field">Short description <input bind:value={f.description} /></label>
  <label class="field">Page language
    <select bind:value={f.language} style="width:100%; min-height:48px"><option value="en">English</option><option value="ml">മലയാളം</option><option value="hi">हिन्दी</option></select>
  </label>
  <label class="field">Link code <span class="hint">Optional. Letters and numbers only, 4 to 12 characters. Leave empty to generate one.</span><input bind:value={f.shortCode} pattern="[a-zA-Z0-9]{'{4,12}'}" placeholder="kz26vd" /></label>

  <h2 style="margin-top:28px">Schedule <small>(India time)</small></h2>
  <div class="two">
    <label class="field">Starts <input type="datetime-local" required bind:value={f.startsAt} /></label>
    <label class="field">Ends <input type="datetime-local" required bind:value={f.endsAt} /></label>
  </div>

  <h2 style="margin-top:28px">Sharing</h2>
  <label class="field">Caption people can copy <textarea rows="3" bind:value={f.caption} placeholder="Proudly representing my college in the Special Enrollment Drive!"></textarea></label>
  <label class="field">Hashtags <input bind:value={f.hashtags} placeholder="#VoteKerala" /></label>
  <label class="field">Thank-you message <textarea rows="3" bind:value={f.thankYou}></textarea></label>
  <label class="field">Link to send people to next <span class="hint">A button under “Invite your friends” on the thank-you screen, for example your Instagram page, website or WhatsApp group. Its label matches the site. Leave empty for no button.</span><input type="url" bind:value={f.ctaUrl} placeholder="https://" /></label>

  <h2 style="margin-top:28px">Save to Google Drive</h2>
  <label class="field">What to save for this campaign
    <select bind:value={f.saveMode}>
      <option value="off">Nothing (numbers only)</option>
      <option value="raw">Original photos only</option>
      <option value="framed">Finished framed pictures only</option>
      <option value="both">Both</option>
    </select>
    <span class="hint">Files go into a folder for this campaign, named from what people type (college, name). Saving original photos shows participants a consent tick box. Connect your Drive first under Google Drive in the menu.</span>
  </label>

  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <button class="btn">{submitLabel}</button>
</form>

<style>
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 520px) { .two { grid-template-columns: 1fr; } }
</style>
