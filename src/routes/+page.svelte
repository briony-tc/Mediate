<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { DiscStore } from '$lib/stores/discs.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Assigned directly (not via $state initializer) so SSR renders the real
	// list immediately instead of flashing empty before hydration - $effect
	// never runs on the server, so it alone would leave this empty for SSR.
	const discStore = new DiscStore();
	// svelte-ignore state_referenced_locally -- intentional: seeds SSR output once, the $effect below keeps it in sync afterward
	discStore.discs = data.discs;
	let unmatched = $state<typeof data.unmatchedFiles>([]);
	// svelte-ignore state_referenced_locally -- intentional: seeds SSR output once, the $effect below keeps it in sync afterward
	unmatched = data.unmatchedFiles;

	let disconnect: (() => void) | undefined;

	// Keeps both in sync if `data` changes after the initial render (e.g.
	// client-side navigation revalidates load()).
	$effect(() => {
		discStore.discs = data.discs;
		unmatched = data.unmatchedFiles;
	});

	onMount(() => {
		disconnect = discStore.connect();
	});

	onDestroy(() => {
		disconnect?.();
	});

	const statusLabel: Record<string, string> = {
		not_started: 'Not started',
		staged: 'Staged',
		complete: 'Complete'
	};

	const statusClass: Record<string, string> = {
		not_started: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
		staged: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
		complete: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
	};

	function discTitle(id: number | null) {
		if (id === null) return `#${id}`;
		return discStore.discs.find((d) => d.id === id)?.title ?? `#${id}`;
	}

	async function link(unmatchedFileId: number, discId: number) {
		const response = await fetch('/api/link', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ unmatchedFileId, discId })
		});
		if (response.ok) {
			unmatched = unmatched.filter((u) => u.id !== unmatchedFileId);
		}
	}

	async function ignore(unmatchedFileId: number) {
		const response = await fetch('/api/ignore', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ unmatchedFileId })
		});
		if (response.ok) {
			unmatched = unmatched.filter((u) => u.id !== unmatchedFileId);
		}
	}
</script>

<div class="mx-auto max-w-3xl space-y-8 p-6">
	<h1 class="text-2xl font-semibold">Library</h1>

	{#if unmatched.length > 0}
		<section class="space-y-3">
			<h2 class="text-lg font-medium">Needs attention ({unmatched.length})</h2>
			<ul class="space-y-2">
				{#each unmatched as file (file.id)}
					<li class="rounded-md border p-3">
						<p class="truncate text-sm">{file.path}</p>
						<p class="text-xs text-gray-500 uppercase">{file.tree}</p>
						{#if file.bestGuessDiscId !== null}
							<p class="mt-1 text-sm">
								Best guess: {discTitle(file.bestGuessDiscId)} ({Math.round(
									(file.bestGuessScore ?? 0) * 100
								)}%)
							</p>
							<button
								class="mt-2 rounded-md border px-3 py-1 text-sm"
								onclick={() => link(file.id, file.bestGuessDiscId!)}
							>
								Link
							</button>
						{/if}
						<button
							class="mt-2 ml-2 rounded-md border px-3 py-1 text-sm"
							onclick={() => ignore(file.id)}
						>
							Ignore
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="space-y-3">
		<h2 class="text-lg font-medium">Discs ({discStore.discs.length})</h2>
		{#if discStore.discs.length === 0}
			<p class="text-sm text-gray-500">
				No discs scanned yet. <a href="/scan" class="underline">Scan one</a>.
			</p>
		{:else}
			<ul class="divide-y">
				{#each discStore.discs as disc (disc.id)}
					<li class="flex items-center justify-between py-3">
						<div>
							<p class="font-medium">
								{disc.title}
								{#if disc.season}<span class="text-gray-500">— Season {disc.season}</span>{/if}
								{#if disc.year}<span class="text-gray-500">({disc.year})</span>{/if}
							</p>
							<p class="text-xs text-gray-500 uppercase">{disc.mediaType}</p>
						</div>
						<span class="rounded-full px-3 py-1 text-xs font-medium {statusClass[disc.status]}">
							{statusLabel[disc.status]}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
