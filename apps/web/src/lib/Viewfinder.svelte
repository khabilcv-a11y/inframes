<script lang="ts">
  // The recurring motif: four coral corners around any block.
  let { children, class: cls = '' }: { children?: import('svelte').Snippet; class?: string } = $props();
</script>

<div class="vf {cls}">
  <i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i>
  {@render children?.()}
</div>

<style>
  .vf { position: relative; }
  .c { position: absolute; width: 18px; height: 18px; border: 0 solid var(--coral); pointer-events: none; transition: transform .35s cubic-bezier(.34, 1.56, .64, 1); }
  .tl { top: 0; left: 0; border-top-width: 3px; border-left-width: 3px; border-top-left-radius: 4px; }
  .tr { top: 0; right: 0; border-top-width: 3px; border-right-width: 3px; border-top-right-radius: 4px; }
  .bl { bottom: 0; left: 0; border-bottom-width: 3px; border-left-width: 3px; border-bottom-left-radius: 4px; }
  .br { bottom: 0; right: 0; border-bottom-width: 3px; border-right-width: 3px; border-bottom-right-radius: 4px; }
</style>
