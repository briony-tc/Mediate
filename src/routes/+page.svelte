<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { DiscStore } from '$lib/stores/discs.svelte';
	import LibraryStats from '$lib/components/LibraryStats.svelte';
	import {
		filterDiscs,
		sortDiscs,
		type MediaTypeFilter,
		type SortKey,
		type StatusFilter
	} from '$lib/library';
	import type { PageData } from './$types';

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
	let searchQuery = $state('');

	let visibleDiscs = $derived(
		sortDiscs(
			filterDiscs(discStore.discs, {
				status: statusFilter,
				mediaType: mediaTypeFilter,
				query: searchQuery
			}),
			sortKey
		)
	);
	let armedDisc = $derived(discStore.discs.find((d) => d.armedAt !== null));
	let unmatched = $state<typeof data.unmatchedFiles>([]);
	// svelte-ignore state_referenced_locally -- intentional: seeds SSR output once, the $effect below keeps it in sync afterward
	unmatched = data.unmatchedFiles;

	let disconnect: (() => void) | undefined;
	// Per-unmatched-file disc picker selection - defaults to the auto-guess,
	// but a flat staging folder name can't always tell which season a rip
	// belongs to (e.g. multiple seasons share the same show title), so the
	// user can pick a different candidate than the guess.
	let selectedDiscId = $state<Record<number, number | undefined>>({});
	function seedSelection(files: typeof data.unmatchedFiles) {
		for (const file of files) {
			if (!(file.id in selectedDiscId)) {
				selectedDiscId[file.id] = file.bestGuessDiscId ?? undefined;
			}
		}
	}
	// svelte-ignore state_referenced_locally -- intentional: seeds SSR output once, the $effect below keeps it in sync afterward
	seedSelection(data.unmatchedFiles);

	// Keeps both in sync if `data` changes after the initial render (e.g.
	// client-side navigation revalidates load()).
	$effect(() => {
		discStore.discs = data.discs;
		unmatched = data.unmatchedFiles;
		seedSelection(data.unmatchedFiles);
	});

	let pushSupported = $state(false);
	let pushEnabled = $state(false);

	// VAPID keys arrive base64url-encoded; the Push API wants raw bytes.
	function urlBase64ToUint8Array(base64: string): Uint8Array {
		const padding = '='.repeat((4 - (base64.length % 4)) % 4);
		const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
		return Uint8Array.from(raw, (char) => char.charCodeAt(0));
	}

	async function enablePush() {
		const permission = await Notification.requestPermission();
		if (permission !== 'granted') return;

		const registration = await navigator.serviceWorker.ready;
		const subscription = await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(data.vapidPublicKey) as BufferSource
		});

		await fetch('/api/push/subscribe', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(subscription)
		});
		pushEnabled = true;
	}

	onMount(() => {
		disconnect = discStore.connect();

		if ('serviceWorker' in navigator && 'PushManager' in window) {
			pushSupported = true;
			navigator.serviceWorker.ready
				.then((registration) => registration.pushManager.getSubscription())
				.then((subscription) => {
					pushEnabled = subscription !== null;
				});
		}
	});

	onDestroy(() => {
		disconnect?.();
	});

	const statusLabel: Record<string, string> = {
		not_started: 'Not started',
		ripping: 'Ripping',
		// 'staged' now means "matched, rip confirmed done, but couldn't be
		// auto-filed into Jellyfin" - auto-filing is near-instant when it works,
		// so this status is now specifically the "needs a look" case.
		staged: 'Needs attention',
		complete: 'Complete'
	};

	const statusClass: Record<string, string> = {
		not_started: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
		ripping: 'animate-pulse bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
		staged: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
		complete: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
	};

	function discTitle(id: number | null) {
		if (id === null) return `#${id}`;
		return discStore.discs.find((d) => d.id === id)?.title ?? `#${id}`;
	}

	function discLabel(disc: (typeof discStore.discs)[number]) {
		const season = disc.season ? ` — Season ${disc.season}` : '';
		return `${disc.title}${season} (${disc.mediaType})`;
	}

	function linkableDiscs() {
		return discStore.discs.filter((d) => d.status !== 'complete');
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

	// Arming is a same-tab user action, not an async filesystem event, so - like
	// link/ignore/removeDisc below - it patches local state directly from the
	// fetch response rather than waiting on an SSE round-trip.
	async function arm(discId: number) {
		const response = await fetch('/api/arm', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ discId })
		});
		if (!response.ok) return;
		const now = Date.now();
		discStore.discs = discStore.discs.map((d) => ({
			...d,
			armedAt: d.id === discId ? now : null
		}));
	}

	async function unarm(discId: number) {
		const response = await fetch('/api/unarm', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ discId })
		});
		if (!response.ok) return;
		discStore.discs = discStore.discs.map((d) => (d.id === discId ? { ...d, armedAt: null } : d));
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
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-semibold">Library</h1>
		{#if pushSupported && !pushEnabled}
			<button
				class="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
				onclick={enablePush}
			>
				Enable notifications
			</button>
		{/if}
	</div>

	<LibraryStats discs={discStore.discs} />

	{#if armedDisc}
		<section
			class="rounded-md border border-blue-300 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950"
		>
			<p class="text-sm">
				<span class="font-medium">Armed for next rip:</span>
				{discLabel(armedDisc)} — waiting for the disc in the drive.
			</p>
			<button class="mt-2 rounded-md border px-3 py-1 text-sm" onclick={() => unarm(armedDisc!.id)}>
				Cancel
			</button>
		</section>
	{/if}

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
									onclick={() => link(file.id, selectedDiscId[file.id]!)}
								>
									Link
								</button>
							</div>
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
		<h2 class="text-lg font-medium">Discs ({visibleDiscs.length} of {discStore.discs.length})</h2>
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
							</p>
							<p class="text-xs text-gray-500 uppercase">{disc.mediaType}</p>
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
								{#if disc.armedAt !== null}
									<span
										class="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200"
									>
										Armed
									</span>
								{:else if disc.status === 'not_started'}
									<button
										class="rounded-md border px-2 py-1 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
										onclick={() => arm(disc.id)}
									>
										Start ripping
									</button>
								{/if}
								<span class="rounded-full px-3 py-1 text-xs font-medium {statusClass[disc.status]}">
									{statusLabel[disc.status]}
								</span>
								<button
									class="rounded-md border px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
									onclick={() => (pendingRemoveId = disc.id)}
								>
									Remove
								</button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
