<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, subtitle = '', back, backHref, actions }: { title: string; subtitle?: string; back?: string; backHref?: string; actions?: Snippet } = $props();
</script>

<header class="ph">
  {#if back && backHref}<a class="back" href={backHref}>← {back}</a>{/if}
  <div class="row">
    <div>
      <h1>{title}</h1>
      {#if subtitle}<p class="muted">{subtitle}</p>{/if}
    </div>
    <span class="spacer"></span>
    {#if actions}<div class="row">{@render actions()}</div>{/if}
  </div>
</header>

<style>
  .ph { margin-bottom: 24px; }
  .back { display: inline-block; margin-bottom: 8px; color: var(--muted); text-decoration: none; font-size: .9rem; }
  .back:hover { color: var(--ink); }
  .ph p { margin: 0; }
</style>
