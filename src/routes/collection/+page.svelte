<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { DiscStore } from '$lib/stores/discs.svelte';
	import LibraryStats from '$lib/components/LibraryStats.svelte';
	import {
		filterDiscs,
		ownershipLabel,
		sortDiscs,
		statusClass,
		statusLabel,
		type MediaTypeFilter,
		type OwnershipFilter,
		type SortKey,
		type StatusFilter
	} from '$lib/library';
	import type { PageData } from './$types';
	import type { Ownership } from '$lib/types';

	let { data }: { data: PageData } = $props();

	// Assigned directly (not via $state initializer) so SSR renders the real
	// list immediately instead of flashing empty before hydration - $effect
	// never runs on the server, so it alone would leave this empty for SSR.
	const discStore = new DiscStore();
	// svelte-ignore state_referenced_locally -- intentional: seeds SSR output once, the $effect below keeps it in sync afterward
	discStore.discs = data.discs;

	let sortKey = $state<SortKey>('title');
	let statusFilter = $state<StatusFilter>('all');
	let mediaTypeFilter = $state<MediaTypeFilter>('all');
	let ownershipFilter = $state<OwnershipFilter>('all');
	let searchQuery = $state('');

	let visibleDiscs = $derived(
		sortDiscs(
			filterDiscs(discStore.discs, {
				status: statusFilter,
				mediaType: mediaTypeFilter,
				ownership: ownershipFilter,
				query: searchQuery
			}),
			sortKey
		)
	);

	let disconnect: (() => void) | undefined;
	let ignoredDialog: HTMLDialogElement | undefined;
	let unlinkDialog: HTMLDialogElement | undefined;
	let unlinkQuery = $state('');

	// Only staged/complete discs actually have anything to unlink - see
	// /api/unlink's own guard for why not_started/ripping are excluded.
	let unlinkableDiscs = $derived(
		discStore.discs.filter((d) => d.status === 'staged' || d.status === 'complete')
	);
	let unlinkResults = $derived(
		unlinkableDiscs.filter((d) => d.title.toLowerCase().includes(unlinkQuery.trim().toLowerCase()))
	);

	let ignored = $state<typeof data.ignoredFiles>([]);
	// svelte-ignore state_referenced_locally -- intentional: seeds SSR output once, the $effect below keeps it in sync afterward
	ignored = data.ignoredFiles;

	// Per-ignored-file disc picker selection - bestGuessDiscId may be stale
	// (recomputed only while a file sits 'unresolved'; an 'ignored' file never
	// gets re-matched, see reconcile.ts's onFileSeen), so this only pre-fills
	// as a starting point, not a guaranteed-correct default.
	let selectedDiscId = $state<Record<number, number | undefined>>({});
	function seedSelection(files: typeof data.ignoredFiles) {
		for (const file of files) {
			if (!(file.id in selectedDiscId)) {
				selectedDiscId[file.id] = file.bestGuessDiscId ?? undefined;
			}
		}
	}
	// svelte-ignore state_referenced_locally -- intentional: seeds SSR output once, the $effect below keeps it in sync afterward
	seedSelection(data.ignoredFiles);

	// Keeps discStore in sync if `data` changes after the initial render (e.g.
	// client-side navigation revalidates load()).
	$effect(() => {
		discStore.discs = data.discs;
		ignored = data.ignoredFiles;
		seedSelection(data.ignoredFiles);
	});

	onMount(() => {
		disconnect = discStore.connect();
	});

	onDestroy(() => {
		disconnect?.();
	});

	function discTitle(id: number | null) {
		if (id === null) return `#${id}`;
		const disc = discStore.discs.find((d) => d.id === id);
		if (!disc) return `#${id}`;
		const discNum = disc.discNumber ? ` — Disc ${disc.discNumber}` : '';
		return `${disc.title}${discNum}`;
	}

	function discLabel(disc: (typeof discStore.discs)[number]) {
		const season = disc.season ? ` — Season ${disc.season}` : '';
		const discNum = disc.discNumber ? ` — Disc ${disc.discNumber}` : '';
		return `${disc.title}${season}${discNum} (${disc.mediaType})`;
	}

	function linkableDiscs() {
		return discStore.discs.filter((d) => d.status !== 'complete');
	}

	async function linkIgnored(unmatchedFileId: number, discId: number) {
		const response = await fetch('/api/link', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ unmatchedFileId, discId })
		});
		if (!response.ok) return;
		const data = await response.json();
		ignored = ignored.filter((u) => u.id !== unmatchedFileId);
		discStore.discs = discStore.discs.map((d) => (d.id === discId ? data.disc : d));
	}

	async function restoreIgnored(unmatchedFileId: number) {
		const response = await fetch('/api/unignore', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ unmatchedFileId })
		});
		if (response.ok) {
			ignored = ignored.filter((u) => u.id !== unmatchedFileId);
		}
	}

	// Inline confirm step rather than a native confirm() dialog - same pattern
	// as pendingRemoveId below, just scoped to the ignored-files list.
	let pendingDeleteId = $state<number | null>(null);

	async function deleteIgnored(unmatchedFileId: number) {
		const response = await fetch('/api/unmatched-remove', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ unmatchedFileId })
		});
		if (response.ok) {
			ignored = ignored.filter((u) => u.id !== unmatchedFileId);
		}
		pendingDeleteId = null;
	}

	// Undoes a bad /api/link match (e.g. an extras subfolder linked instead of
	// the movie's own folder) - resets the disc to not_started so the correct
	// unmatched file can be linked instead.
	async function unlinkDisc(discId: number) {
		const response = await fetch('/api/unlink', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ discId })
		});
		if (!response.ok) return;
		const data = await response.json();
		discStore.discs = discStore.discs.map((d) => (d.id === discId ? data.disc : d));
	}

	async function setOwnership(discId: number, ownership: Ownership) {
		const response = await fetch('/api/ownership', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ discId, ownership })
		});
		if (!response.ok) return;
		discStore.discs = discStore.discs.map((d) => (d.id === discId ? { ...d, ownership } : d));
	}

	// Inline confirm step rather than a native confirm() dialog - only one
	// disc's confirmation shows at a time.
	let pendingRemoveId = $state<number | null>(null);

	async function removeDisc(discId: number) {
		const response = await fetch('/api/remove', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ discId })
		});
		if (response.ok) {
			discStore.discs = discStore.discs.filter((d) => d.id !== discId);
		}
		pendingRemoveId = null;
	}
</script>

<div class="mx-auto max-w-3xl space-y-8 p-6">
	<h1 class="text-2xl font-semibold">Collection</h1>

	<LibraryStats discs={discStore.discs} />

	<div class="flex flex-wrap gap-2">
		{#if ignored.length > 0}
			<button
				class="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
				onclick={() => ignoredDialog?.showModal()}
			>
				Ignored files ({ignored.length})
			</button>
		{/if}
		{#if unlinkableDiscs.length > 0}
			<button
				class="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
				onclick={() => unlinkDialog?.showModal()}
			>
				Unlink a title ({unlinkableDiscs.length})
			</button>
		{/if}
	</div>

	<dialog
		bind:this={ignoredDialog}
		class="m-auto max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-md border bg-white p-6 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
	>
		<div class="flex items-center justify-between">
			<h2 class="text-lg font-medium">Ignored files ({ignored.length})</h2>
			<button
				class="rounded-md border p-1.5 text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-gray-100"
				onclick={() => ignoredDialog?.close()}
				aria-label="Close"
			>
				✕
			</button>
		</div>
		<p class="mt-2 text-sm text-gray-500">
			Files the watcher couldn't match that were dismissed - e.g. a digital-only copy ignored before
			its title was added here. Link one to a title below, restore it so it shows up again under Rip
			Queue's "Needs attention", or delete it permanently.
		</p>
		<ul class="mt-4 space-y-2">
			{#each ignored as file (file.id)}
				<li class="rounded-md border p-3">
					<p class="truncate text-sm">{file.path}</p>
					<p class="text-xs text-gray-500 uppercase">{file.tree}</p>
					{#if file.bestGuessDiscId !== null}
						<p class="mt-1 text-sm">
							Best guess: {discTitle(file.bestGuessDiscId)} ({Math.round(
								(file.bestGuessScore ?? 0) * 100
							)}%)
						</p>
					{/if}
					{#if linkableDiscs().length > 0}
						<div class="mt-2 flex flex-wrap items-center gap-2">
							<select bind:value={selectedDiscId[file.id]} class="rounded-md border p-1 text-sm">
								<option value={undefined}>Pick a disc…</option>
								{#each linkableDiscs() as disc (disc.id)}
									<option value={disc.id}>{discLabel(disc)}</option>
								{/each}
							</select>
							<button
								class="rounded-md border px-3 py-1 text-sm"
								disabled={selectedDiscId[file.id] === undefined}
								onclick={() => linkIgnored(file.id, selectedDiscId[file.id]!)}
							>
								Link
							</button>
						</div>
					{/if}
					{#if pendingDeleteId === file.id}
						<div class="mt-2 flex items-center gap-2 text-sm">
							<span class="text-gray-500">Delete permanently?</span>
							<button
								class="rounded-md border border-red-600 px-2 py-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
								onclick={() => deleteIgnored(file.id)}
							>
								Confirm
							</button>
							<button class="rounded-md border px-2 py-1" onclick={() => (pendingDeleteId = null)}>
								Cancel
							</button>
						</div>
					{:else}
						<button
							class="mt-2 rounded-md border px-3 py-1 text-sm"
							onclick={() => restoreIgnored(file.id)}
						>
							Restore
						</button>
						<button
							class="mt-2 ml-2 rounded-md border border-red-600 px-3 py-1 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
							onclick={() => (pendingDeleteId = file.id)}
						>
							Delete
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	</dialog>

	<dialog
		bind:this={unlinkDialog}
		class="m-auto max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-md border bg-white p-6 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
	>
		<div class="flex items-center justify-between">
			<h2 class="text-lg font-medium">Unlink a title</h2>
			<button
				class="rounded-md border p-1.5 text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-gray-100"
				onclick={() => {
					unlinkDialog?.close();
					unlinkQuery = '';
				}}
				aria-label="Close"
			>
				✕
			</button>
		</div>
		<p class="mt-2 text-sm text-gray-500">
			Undoes a bad match (e.g. an extras subfolder linked instead of the movie's own folder) -
			resets the title to Not started and puts the wrongly-linked file back under Rip Queue's "Needs
			attention" so you can link the right one instead.
		</p>
		<input
			type="text"
			bind:value={unlinkQuery}
			placeholder="Search titles…"
			class="mt-3 w-full rounded-md border p-2 text-sm"
			onfocus={(e) => e.currentTarget.select()}
		/>
		{#if unlinkResults.length === 0}
			<p class="mt-3 text-sm text-gray-500">No matching titles.</p>
		{/if}
		<ul class="mt-3 space-y-2">
			{#each unlinkResults as disc (disc.id)}
				<li class="flex items-center justify-between rounded-md border p-3">
					<div>
						<p class="font-medium">
							{disc.title}
							{#if disc.season}<span class="text-gray-500">— Season {disc.season}</span>{/if}
							{#if disc.discNumber}<span class="text-gray-500">— Disc {disc.discNumber}</span>{/if}
							{#if disc.year}<span class="text-gray-500">({disc.year})</span>{/if}
						</p>
						<span
							class="mt-1 inline-block rounded-full px-3 py-1 text-xs font-medium {statusClass[
								disc.status
							]}"
						>
							{statusLabel[disc.status]}
						</span>
					</div>
					<button class="rounded-md border px-3 py-1 text-sm" onclick={() => unlinkDisc(disc.id)}>
						Unlink
					</button>
				</li>
			{/each}
		</ul>
	</dialog>

	<section class="space-y-3">
		<h2 class="text-lg font-medium">Titles ({visibleDiscs.length} of {discStore.discs.length})</h2>
		{#if discStore.discs.length === 0}
			<p class="text-sm text-gray-500">
				No discs scanned yet. <a href="/scan" class="underline">Scan one</a>.
			</p>
		{:else}
			<div class="flex flex-wrap items-center gap-2">
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search titles…"
					class="flex-1 rounded-md border p-2 text-sm"
					onfocus={(e) => e.currentTarget.select()}
				/>
				<select bind:value={statusFilter} class="rounded-md border p-2 text-sm">
					<option value="all">All statuses</option>
					<option value="not_started">Not started</option>
					<option value="ripping">Ripping</option>
					<option value="staged">Needs attention</option>
					<option value="complete">Complete</option>
				</select>
				<select bind:value={mediaTypeFilter} class="rounded-md border p-2 text-sm">
					<option value="all">Movies & TV</option>
					<option value="movie">Movies</option>
					<option value="tv">TV</option>
				</select>
				<select bind:value={ownershipFilter} class="rounded-md border p-2 text-sm">
					<option value="all">All ownership</option>
					<option value="owned">Owned</option>
					<option value="wanted">Wanted</option>
					<option value="digital_only">Digital only</option>
				</select>
				<select bind:value={sortKey} class="rounded-md border p-2 text-sm">
					<option value="updated">Recently updated</option>
					<option value="title">Title (A–Z)</option>
					<option value="year">Year (newest)</option>
					<option value="status">Status</option>
				</select>
			</div>
			{#if visibleDiscs.length === 0}
				<p class="text-sm text-gray-500">No discs match these filters.</p>
			{/if}
			<ul class="divide-y">
				{#each visibleDiscs as disc (disc.id)}
					<li class="flex items-center justify-between py-3">
						<div>
							<p class="font-medium">
								{disc.title}
								{#if disc.season}<span class="text-gray-500">— Season {disc.season}</span>{/if}
								{#if disc.year}<span class="text-gray-500">({disc.year})</span>{/if}
								{#if disc.discNumber}<span class="text-gray-500">— Disc {disc.discNumber}</span
									>{/if}
							</p>
							<p class="text-xs text-gray-500 uppercase">{disc.mediaType}</p>
							<span
								class="mt-1 inline-block rounded-full px-3 py-1 text-xs font-medium {statusClass[
									disc.status
								]}"
							>
								{statusLabel[disc.status]}
							</span>
							{#if disc.ownership !== 'owned'}
								<span
									class="mt-1 ml-1 inline-block rounded-full bg-purple-100 px-3 py-1 text-xs font-medium text-purple-800 dark:bg-purple-900 dark:text-purple-200"
								>
									{ownershipLabel[disc.ownership]}
								</span>
							{/if}
						</div>
						{#if pendingRemoveId === disc.id}
							<div class="flex items-center gap-2 text-sm">
								<span class="text-gray-500">Remove?</span>
								<button
									class="rounded-md border border-red-600 px-2 py-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
									onclick={() => removeDisc(disc.id)}
								>
									Confirm
								</button>
								<button
									class="rounded-md border px-2 py-1"
									onclick={() => (pendingRemoveId = null)}
								>
									Cancel
								</button>
							</div>
						{:else}
							<div class="flex items-center gap-2">
								<select
									value={disc.ownership}
									onchange={(e) => setOwnership(disc.id, e.currentTarget.value as Ownership)}
									aria-label="Ownership for {disc.title}"
									class="rounded-md border p-1 text-xs"
								>
									<option value="owned">Owned</option>
									<option value="wanted">Wanted</option>
									<option value="digital_only">Digital only</option>
								</select>
								<button
									class="rounded-md border p-1.5 text-gray-500 hover:bg-gray-50 hover:text-red-600 dark:hover:bg-gray-800"
									onclick={() => (pendingRemoveId = disc.id)}
									aria-label="Remove disc"
									title="Remove"
								>
									<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
										<path
											fill-rule="evenodd"
											d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
											clip-rule="evenodd"
										/>
									</svg>
								</button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	dialog::backdrop {
		background: rgb(0 0 0 / 0.5);
	}
</style>
