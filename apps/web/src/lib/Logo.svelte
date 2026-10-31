<script lang="ts">
  let { size = 28, dark = false }: { size?: number; dark?: boolean } = $props();
</script>

<span class="logo" style="--s:{size}px; color:{dark ? '#fff' : 'var(--ink)'}">
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <path d="M6 12V6h6M20 6h6v6M26 20v6h-6M12 26H6v-6" stroke="#E8553D" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round" />
    <circle class="dot" cx="16" cy="16" r="3" fill="#E8553D" />
  </svg>
  <span class="word">InFrame</span>
</span>

<style>
  .logo { display: inline-flex; align-items: center; gap: 8px; font: 700 calc(var(--s) * .78) var(--display); letter-spacing: -0.03em; }
  .dot { animation: blink 1.6s infinite; }
  @keyframes blink { 0%, 60% { opacity: 1; } 80%, 100% { opacity: .25; } }
</style>
