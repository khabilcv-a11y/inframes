<script lang="ts">
  import { istInputToIso, isoToIstInput } from '$lib/time';

  type Initial = {
    title?: string; description?: string | null; language?: string; startsAt?: string; endsAt?: string;
    caption?: string | null; hashtags?: string | null; thankYou?: string | null; ctaUrl?: string | null; shortCode?: string;
  };
  let { initial = {}, orgs = [], submitLabel, onsubmit, error = '' }: {
    initial?: Initial; orgs?: { id: string; name: string }[]; submitLabel: string;
    onsubmit: (payload: Record<string, unknown>) => void; error?: string;
  } = $props();

  let f = $state({
    title: initial.title ?? '', description: initial.description ?? '', language: initial.language ?? 'en',
    startsAt: initial.startsAt ? isoToIstInput(initial.startsAt) : '', endsAt: initial.endsAt ? isoToIstInput(initial.endsAt) : '',
    caption: initial.caption ?? '', hashtags: initial.hashtags ?? '', thankYou: initial.thankYou ?? '',
    ctaUrl: initial.ctaUrl ?? '', shortCode: initial.shortCode ?? '', orgId: ''
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const clean = (v: string) => (v.trim() ? v.trim() : undefined);
    onsubmit({
      title: f.title, description: clean(f.description), language: f.language,
      startsAt: istInputToIso(f.startsAt), endsAt: istInputToIso(f.endsAt),
      caption: clean(f.caption), hashtags: clean(f.hashtags), thankYou: clean(f.thankYou), ctaUrl: clean(f.ctaUrl),
      shortCode: clean(f.shortCode)?.toLowerCase(), orgId: clean(f.orgId)
    });
  }
</script>

<form onsubmit={submit}>
  <h2>1. Basics</h2>
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
  <label class="field">Link code (leave empty to auto-generate) <input bind:value={f.shortCode} pattern="[a-zA-Z0-9]{'{4,12}'}" placeholder="kz26vd" /></label>

  <h2>2. Schedule (India time)</h2>
  <label class="field">Starts <input type="datetime-local" required bind:value={f.startsAt} /></label>
  <label class="field">Ends <input type="datetime-local" required bind:value={f.endsAt} /></label>

  <h2>3. Sharing</h2>
  <label class="field">Caption people can copy <input bind:value={f.caption} /></label>
  <label class="field">Hashtags <input bind:value={f.hashtags} placeholder="#VoteKerala" /></label>
  <label class="field">Thank-you message <input bind:value={f.thankYou} /></label>
  <label class="field">Call-to-action link <input type="url" bind:value={f.ctaUrl} placeholder="https://" /></label>

  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <button class="btn">{submitLabel}</button>
</form>
