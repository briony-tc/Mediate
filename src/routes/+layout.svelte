<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import './layout.css';
	import favicon from '$lib/assets/favicon.png';
	import { initTheme, isDark, toggleTheme } from '$lib/theme';

	let { children } = $props();

	const tabs = [
		{ href: '/', label: 'Queue' },
		{ href: '/collection', label: 'Collection' },
		{ href: '/scan', label: 'Scan' }
	];
	let pathname = $derived(page.url.pathname);

	// The inline script in app.html already set the class before first
	// paint (avoiding a flash) - this just brings Svelte's own state in
	// sync with it so the button's icon matches on mount.
	let dark = $state(false);
	onMount(() => {
		initTheme();
		dark = isDark();

		// Push notifications (see enablePush() on the rip queue page) depend on
		// this being registered first - SvelteKit builds src/service-worker.ts
		// but never registers it for you.
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker.register('/service-worker.js');
		}
	});
</script>

<svelte:head>
	<title>Mediate</title>
	<link rel="icon" href={favicon} />
</svelte:head>

<nav class="border-b p-4">
	<div class="mx-auto flex max-w-3xl items-center gap-4">
		<!-- Web only - the installed app gets the same three destinations as a
		     bottom icon tab bar instead (below), so this whole group is redundant
		     there. -->
		<div class="flex items-center gap-4 standalone:hidden">
			<a href="/" class="font-medium hover:underline">Rip Queue</a>
			<a href="/collection" class="font-medium hover:underline">Collection</a>
			<a href="/scan" class="font-medium hover:underline">Scan</a>
		</div>
		<span class="hidden font-semibold standalone:inline">Mediate</span>
		<button
			type="button"
			class="ml-auto rounded-md border p-1.5 hover:bg-gray-50 dark:hover:bg-gray-800"
			onclick={() => (dark = toggleTheme())}
			aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
			title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
		>
			{#if dark}
				<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
					<path
						d="M10 2a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 2ZM10 15a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 15ZM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM15.657 5.404a.75.75 0 1 0-1.06-1.06l-1.061 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM6.464 14.596a.75.75 0 1 0-1.06-1.06l-1.061 1.06a.75.75 0 0 0 1.06 1.061l1.06-1.06ZM18 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 18 10ZM5 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 5 10ZM14.596 15.657a.75.75 0 0 0 1.06-1.06l-1.06-1.061a.75.75 0 1 0-1.06 1.06l1.06 1.06ZM5.404 6.464a.75.75 0 0 0 1.06-1.06l-1.06-1.061a.75.75 0 1 0-1.061 1.06l1.06 1.06Z"
					/>
				</svg>
			{:else}
				<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
					<path
						fill-rule="evenodd"
						d="M17.293 13.293A8 8 0 0 1 6.707 2.707a8.001 8.001 0 1 0 10.586 10.586Z"
						clip-rule="evenodd"
					/>
				</svg>
			{/if}
		</button>
	</div>
</nav>

<div class="standalone:pb-20">
	{@render children()}
</div>

<!-- App only - see the standalone custom variant in layout.css. Fixed to the
     bottom so it reads as a real tab bar rather than part of the page; the
     div above keeps it from covering the last bit of scrolled content. -->
<nav
	class="fixed inset-x-0 bottom-0 hidden border-t bg-white dark:border-gray-700 dark:bg-gray-900 standalone:flex"
	style="padding-bottom: env(safe-area-inset-bottom)"
>
	{#each tabs as tab (tab.href)}
		{@const active = pathname === tab.href}
		<a
			href={tab.href}
			class="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs {active
				? 'text-blue-600 dark:text-blue-400'
				: 'text-gray-500 dark:text-gray-400'}"
			aria-current={active ? 'page' : undefined}
		>
			{#if tab.href === '/'}
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="h-6 w-6"
				>
					<line x1="4" y1="6" x2="20" y2="6" />
					<line x1="4" y1="12" x2="20" y2="12" />
					<line x1="4" y1="18" x2="14" y2="18" />
				</svg>
			{:else if tab.href === '/collection'}
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="h-6 w-6"
				>
					<rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
					<rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
					<rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
					<rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
				</svg>
			{:else}
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="h-6 w-6"
				>
					<path d="M4 8V4h4" />
					<path d="M16 4h4v4" />
					<path d="M20 16v4h-4" />
					<path d="M8 20H4v-4" />
				</svg>
			{/if}
			{tab.label}
		</a>
	{/each}
</nav>
