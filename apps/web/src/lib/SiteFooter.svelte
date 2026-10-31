<script lang="ts">
  import Logo from './Logo.svelte';
  let { compact = false }: { compact?: boolean } = $props();
</script>

<footer class:compact>
  {#if !compact}<a href="/" aria-label="InFrame home"><Logo size={22} dark /></a><span class="tag">Be part of the picture.</span><span class="spacer"></span>{/if}
  <span class="credit">Designed &amp; developed by <strong>CV</strong></span>
  <a href="/admin/login">Admin login</a>
</footer>

<style>
  footer { background: var(--ink); color: #9a9aa6; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; padding: 24px clamp(16px, 4vw, 48px); border-top: 1px solid #2a2a31; }
  footer.compact { justify-content: center; background: transparent; border: 0; padding: 16px; color: var(--muted); font-size: .85rem; }
  .tag { color: #b9b9c4; }
  .spacer { flex: 1; }
  .credit strong { color: var(--coral); letter-spacing: .05em; }
  footer a { color: #c9c9d1; }
  footer.compact a { color: var(--muted); }
</style>
