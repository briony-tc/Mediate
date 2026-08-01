<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<nav class="border-b p-4">
	<div class="mx-auto flex max-w-3xl gap-4">
		<a href="/" class="font-medium hover:underline">Library</a>
		<a href="/scan" class="font-medium hover:underline">Scan</a>
	</div>
</nav>

{@render children()}
