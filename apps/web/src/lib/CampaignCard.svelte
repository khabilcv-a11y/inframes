<script lang="ts">
  export type Card = { title: string; code: string; state: string; organisation: string; orgSlug: string; logoUrl: string | null; coverUrl: string | null; participants: number };
  let { c }: { c: Card } = $props();
  const n = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '')}K` : String(v));
</script>

<a class="card" href={`/c/${c.code}`}>
  <div class="tile">
    {#if c.state !== 'live'}<span class="badge {c.state}">{c.state === 'scheduled' ? 'Soon' : c.state}</span>{/if}
    <div class="thumb">
      <svg class="sil" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="38" r="14" /><path d="M20 100c0-22 13-34 30-34s30 12 30 34z" /></svg>
      {#if c.coverUrl}<img src={c.coverUrl} alt="" loading="lazy" />{:else}<span class="blank">{c.title}</span>{/if}
    </div>
  </div>
  <h3>{c.title}</h3>
  <p class="org">
    {#if c.logoUrl}<img class="av" src={c.logoUrl} alt="" />{:else}<span class="av ph">{c.organisation.slice(0, 1)}</span>{/if}
    <span>{c.organisation}</span>
  </p>
  <p class="count" title="Frames created">👥 {n(c.participants)}</p>
</a>

<style>
  .card { display: block; text-decoration: none; color: inherit; padding: 0; border: 0; background: transparent; box-shadow: none; }
  .tile { position: relative; background: #eaf3f1; border-radius: 18px; padding: 16px; display: grid; place-items: center; transition: transform .2s, box-shadow .2s; }
  .card:hover .tile { transform: translateY(-3px); box-shadow: 0 10px 28px rgb(22 22 26 / 14%); }
  .thumb { position: relative; width: 78%; aspect-ratio: 1; border-radius: 12px; overflow: hidden; background: linear-gradient(#d9d9d2, #b9b9b0); box-shadow: 0 4px 14px rgb(22 22 26 / 20%); }
  .sil { position: absolute; inset: 0; width: 100%; height: 100%; fill: #f4f4ef; }
  .thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .blank { position: absolute; inset: 0; display: grid; place-items: center; padding: 12px; text-align: center; font: 700 1rem var(--display); color: var(--ink); }
  .badge { position: absolute; top: 10px; left: 10px; z-index: 2; background: #fff; }
  h3 { margin: 12px 4px 4px; font-size: 1.05rem; line-height: 1.25; }
  .org { display: flex; align-items: center; gap: 8px; margin: 0 4px 2px; color: var(--muted); font-size: .9rem; }
  .av { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; flex: none; background: #fff; border: 1px solid var(--line); }
  .av.ph { display: grid; place-items: center; background: var(--ink); color: #fff; font-size: .7rem; font-weight: 700; border: 0; }
  .count { margin: 0 4px; color: var(--muted); font-size: .85rem; }
</style>
