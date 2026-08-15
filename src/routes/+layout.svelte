<script lang="ts">
	import { onMount } from 'svelte';
	import './layout.css';
	import favicon from '$lib/assets/favicon.png';
	import { initTheme, isDark, toggleTheme } from '$lib/theme';

	let { children } = $props();

	// The inline script in app.html already set the class before first
	// paint (avoiding a flash) - this just brings Svelte's own state in
	// sync with it so the button's icon matches on mount.
	let dark = $state(false);
	onMount(() => {
		initTheme();
		dark = isDark();
	});
</script>

<svelte:head>
	<title>Mediate</title>
	<link rel="icon" href={favicon} />
</svelte:head>

<nav class="border-b p-4">
	<div class="mx-auto flex max-w-3xl items-center gap-4">
		<a href="/" class="font-medium hover:underline">Rip Queue</a>
		<a href="/collection" class="font-medium hover:underline">Collection</a>
		<a href="/scan" class="font-medium hover:underline">Scan</a>
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

{@render children()}
