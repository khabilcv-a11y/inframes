<script lang="ts">
  import { onMount } from 'svelte';

  // Renders the Cloudflare Turnstile widget only when the site has a key; otherwise it does nothing.
  let { siteKey, token = $bindable(''), reset = 0 }: { siteKey: string | null; token?: string; reset?: number } = $props();
  type TS = { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void };
  let el = $state<HTMLDivElement>();
  let widget = '';

  function load(): Promise<TS> {
    const w = window as unknown as { turnstile?: TS };
    if (w.turnstile) return Promise.resolve(w.turnstile);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => resolve((window as unknown as { turnstile: TS }).turnstile);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  onMount(() => {
    if (!siteKey) return;
    load().then((ts) => {
      widget = ts.render(el!, { sitekey: siteKey, appearance: 'interaction-only', callback: (t: string) => (token = t), 'expired-callback': () => (token = ''), 'error-callback': () => (token = '') });
    }).catch(() => {});
  });

  $effect(() => {
    if (reset && widget) { token = ''; (window as unknown as { turnstile?: TS }).turnstile?.reset(widget); }
  });
</script>

{#if siteKey}<div bind:this={el} style="margin:8px 0"></div>{/if}
