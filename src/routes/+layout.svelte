<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.png';

	let { children } = $props();
</script>

<svelte:head>
	<title>Mediate</title>
	<link rel="icon" href={favicon} />
</svelte:head>

<nav class="border-b p-4">
	<div class="mx-auto flex max-w-3xl gap-4">
		<a href="/" class="font-medium hover:underline">Rip Queue</a>
		<a href="/collection" class="font-medium hover:underline">Collection</a>
		<a href="/scan" class="font-medium hover:underline">Scan</a>
	</div>
</nav>

{@render children()}
