<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, getMe } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import Logo from '$lib/Logo.svelte';

  let { children } = $props();
  let open = $state(false);

  const bare = $derived(page.url.pathname === '/admin/login' || page.url.pathname === '/admin/change-password');

  onMount(async () => {
    if (bare) { session.loaded = true; return; }
    const r = await getMe();
    if (!r.ok) return goto('/admin/login');
    if (r.data.user.mustChangePassword) return goto('/admin/change-password');
    session.user = r.data.user;
    session.loaded = true;
  });

  // Re-check when arriving from the login page without a full reload.
  $effect(() => {
    if (!bare && !session.user && session.loaded) {
      getMe().then((r) => { if (r.ok && !r.data.user.mustChangePassword) session.user = r.data.user; else goto('/admin/login'); });
    }
  });

  const nav = $derived(
    [
      { href: '/admin', label: 'Dashboard', icon: '▦' },
      { href: '/admin/campaigns', label: 'Campaigns', icon: '◉' },
      { href: '/admin/photos', label: 'Event photos', icon: '▣' },
      ...(session.user?.role === 'super_admin'
        ? [
            { href: '/admin/organisations', label: 'Organisations', icon: '⌂' },
            { href: '/admin/admins', label: 'Admins', icon: '☺' },
            { href: '/admin/drive', label: 'Google Drive', icon: '☁' },
            { href: '/admin/activity', label: 'Activity log', icon: '☰' }
          ]
        : [])
    ]
  );
  const active = (href: string) => (href === '/admin' ? page.url.pathname === '/admin' : page.url.pathname.startsWith(href));

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    session.user = null;
    await goto('/admin/login');
  }
</script>

{#if bare}
  {@render children()}
{:else if session.user}
  <div class="shell">
    <header class="top">
      <button class="menu" aria-label="Menu" aria-expanded={open} onclick={() => (open = !open)}>☰</button>
      <a href="/admin" class="brand"><Logo size={26} /></a>
    </header>
    <aside class:open>
      <a href="/admin" class="brand desk"><Logo size={28} dark /></a>
      <nav aria-label="Main">
        {#each nav as n}
          <a href={n.href} class:active={active(n.href)} onclick={() => (open = false)}><span class="ic" aria-hidden="true">{n.icon}</span>{n.label}</a>
        {/each}
      </nav>
      <div class="me">
        <div class="who"><strong>{session.user.name}</strong><small>{session.user.role.replace('_', ' ')}</small></div>
        <button class="sm out" onclick={logout}>Sign out</button>
      </div>
    </aside>
    {#if open}<button class="scrim" aria-label="Close menu" onclick={() => (open = false)}></button>{/if}
    <main>{@render children()}</main>
  </div>
{:else}
  <p style="padding:48px; text-align:center" class="muted">Loading…</p>
{/if}

<style>
  .shell { min-height: 100vh; display: grid; grid-template-columns: 248px 1fr; }
  aside { background: var(--ink); color: #fff; padding: 20px 14px; display: flex; flex-direction: column; gap: 20px; position: sticky; top: 0; height: 100vh; }
  .brand.desk { padding: 4px 10px; text-decoration: none; }
  nav { display: flex; flex-direction: column; gap: 4px; }
  nav a { display: flex; align-items: center; gap: 12px; padding: 11px 12px; border-radius: 10px; color: #c9c9d1; text-decoration: none; font-weight: 500; }
  nav a:hover { background: #24242b; color: #fff; }
  nav a.active { background: var(--coral); color: #fff; }
  .ic { width: 20px; text-align: center; opacity: .9; }
  .me { margin-top: auto; border-top: 1px solid #2f2f37; padding: 14px 8px 0; display: flex; gap: 8px; align-items: center; justify-content: space-between; }
  .who { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
  .who strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who small { color: #9a9aa5; text-transform: capitalize; }
  .out { background: transparent; color: #fff; border-color: #3a3a44; }
  .out:hover:not(:disabled) { background: #24242b; border-color: #55555f; }
  main { padding: 32px clamp(16px, 4vw, 40px) 64px; min-width: 0; max-width: 1100px; width: 100%; }
  .top { display: none; }
  .scrim { display: none; }

  @media (max-width: 860px) {
    .shell { grid-template-columns: 1fr; }
    .top { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: var(--ink); position: sticky; top: 0; z-index: 20; }
    .top .menu { background: transparent; color: #fff; border-color: #3a3a44; width: 44px; padding: 0; font-size: 1.2rem; }
    .top .brand { text-decoration: none; }
    .top :global(.logo) { color: #fff !important; }
    aside { position: fixed; z-index: 30; left: 0; top: 0; bottom: 0; width: 272px; height: auto; transform: translateX(-100%); transition: transform .25s ease; }
    aside.open { transform: none; }
    .brand.desk { display: none; }
    .scrim { display: block; position: fixed; inset: 0; z-index: 25; background: rgb(0 0 0 / 45%); border: 0; border-radius: 0; }
    main { padding-top: 20px; }
  }
</style>
