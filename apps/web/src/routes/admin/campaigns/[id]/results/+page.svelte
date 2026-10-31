<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { api } from '$lib/api';

  type M = { funnel: { visits: number; picked: number; created: number; shared: number; downloaded: number }; perDay: { day: string; count: number }[];
    byTemplate: { name: string; count: number }[]; byDropdown: { label: string | null; rows: { name: string; count: number }[] }; errors: number };
  const id = page.params.id;
  let m = $state<M | null>(null);
  onMount(async () => { const r = await api<M>(`/admin/campaigns/${id}/metrics`); if (r.ok) m = r.data; });

  const steps = $derived(m ? [
    ['Visited', m.funnel.visits], ['Picked a photo', m.funnel.picked], ['Created a frame', m.funnel.created],
    ['Shared', m.funnel.shared], ['Downloaded', m.funnel.downloaded]
  ] as [string, number][] : []);
  const top = $derived(Math.max(1, ...steps.map((s) => s[1])));
  const maxDay = $derived(Math.max(1, ...(m?.perDay.map((d) => d.count) ?? [1])));
</script>

{#if m}
  <div class="row" style="margin-bottom:16px">
    <div class="card stat" style="min-width:160px"><div class="n">{m.funnel.created.toLocaleString('en-IN')}</div><div class="l">Frames created</div></div>
    <div class="card stat" style="min-width:160px"><div class="n">{m.funnel.visits ? Math.round((m.funnel.created / m.funnel.visits) * 100) : 0}%</div><div class="l">Visitors who created one</div></div>
    <span class="spacer"></span>
    <a class="btn ghost" href={`/api/admin/campaigns/${id}/export.csv`}>Export CSV</a>
  </div>

  <div class="grid two">
    <section class="card">
      <h2>Funnel</h2>
      {#each steps as [label, n]}
        <div class="bar"><span>{label}</span><div class="track"><i style="width:{(n / top) * 100}%"></i></div><b>{n}</b></div>
      {/each}
      <p class="muted"><small>Counts are unique people. Errors recorded: {m.errors}.</small></p>
    </section>

    <section class="card">
      <h2>Frames per day</h2>
      {#each m.perDay as d}
        <div class="bar"><span>{d.day.slice(5)}</span><div class="track"><i style="width:{(d.count / maxDay) * 100}%"></i></div><b>{d.count}</b></div>
      {:else}<p class="empty">No frames yet.</p>{/each}
    </section>

    {#if m.byDropdown.label}
      <section class="card">
        <h2>By {m.byDropdown.label.toLowerCase()}</h2>
        {#each m.byDropdown.rows as r}
          <div class="bar"><span>{r.name}</span><div class="track"><i style="width:{(r.count / (m.byDropdown.rows[0]?.count || 1)) * 100}%"></i></div><b>{r.count}</b></div>
        {:else}<p class="empty">Nothing yet.</p>{/each}
      </section>
    {/if}

    {#if m.byTemplate.length > 1}
      <section class="card">
        <h2>By frame</h2>
        {#each m.byTemplate as r}<div class="bar"><span>{r.name}</span><div class="track"><i style="width:{(r.count / (m.byTemplate[0]?.count || 1)) * 100}%"></i></div><b>{r.count}</b></div>{/each}
      </section>
    {/if}
  </div>
{:else}
  <p class="muted">Loading…</p>
{/if}

<style>
  .two { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
  .bar { display: grid; grid-template-columns: 130px 1fr 44px; gap: 12px; align-items: center; margin: 10px 0; font-size: .92rem; }
  .bar span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar b { text-align: right; font-variant-numeric: tabular-nums; }
  .track { height: 12px; background: #eeeee9; border-radius: 99px; overflow: hidden; }
  .track i { display: block; height: 100%; background: var(--coral); border-radius: 99px; min-width: 2px; }
</style>
