<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { DiscStore } from '$lib/stores/discs.svelte';
	import {
		filterDiscs,
		formatStaleDuration,
		isStaleRip,
		ownershipLabel,
		pipelineEventLabel,
		sortDiscs,
		statusClass,
		statusLabel,
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
	let pipelineEvents = $state<typeof data.pipelineEvents>([]);
	// svelte-ignore state_referenced_locally -- intentional: seeds SSR output once, the $effect below keeps it in sync afterward
	pipelineEvents = data.pipelineEvents;
	// Ticks once a minute so isStaleRip(disc, now) below stays current without
	// needing a page reload - staleness is purely a wall-clock comparison, not
	// something an SSE event would ever announce on its own.
	let now = $state(Date.now());

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
		pipelineEvents = data.pipelineEvents;
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

	let staleTickInterval: ReturnType<typeof setInterval> | undefined;

	onMount(() => {
		disconnect = discStore.connect();
		staleTickInterval = setInterval(() => (now = Date.now()), 60_000);

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
		clearInterval(staleTickInterval);
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

	/**
	 * TV episode numbering (see promoteToJellyfin) continues from whatever's
	 * already filed for the season, so ripping out of disc order produces
	 * wrong episode numbers - this is what keeps "Start ripping" hidden for a
	 * later disc until every earlier disc of the same title/season reaches
	 * 'complete'. A UI-level guard only (not enforced by /api/arm itself), so
	 * it's not foolproof against multiple tabs/clients, but it's enough to
	 * stop the mistake happening by accident in normal use.
	 */
	function earlierDiscIncomplete(disc: (typeof discStore.discs)[number]): boolean {
		if (disc.discNumber === null || disc.discNumber <= 1) return false;
		return discStore.discs.some(
			(d) =>
				d.id !== disc.id &&
				d.watchmodeId === disc.watchmodeId &&
				d.season === disc.season &&
				d.discNumber !== null &&
				d.discNumber < disc.discNumber! &&
				d.status !== 'complete'
		);
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
		if (!response.ok) return;
		const data = await response.json();
		unmatched = unmatched.filter((u) => u.id !== unmatchedFileId);
		discStore.discs = discStore.discs.map((d) => (d.id === discId ? data.disc : d));
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

	// Separate pending/error state from pendingRemoveId below - resetting and
	// removing are different destructive actions that can't both be pending
	// for the same disc at once, but keeping them as distinct state avoids
	// any temptation to overload one id for two different meanings.
	let pendingResetId = $state<number | null>(null);
	let resetErrors = $state<Record<number, string>>({});

	async function resetDisc(discId: number) {
		const response = await fetch('/api/unlink', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ discId })
		});
		const data = await response.json();
		if (!response.ok) {
			// Left open (not cleared) so the 409 safety-check message stays
			// visible instead of silently reverting to the normal action row.
			resetErrors = { ...resetErrors, [discId]: data.error };
			return;
		}
		discStore.discs = discStore.discs.map((d) => (d.id === discId ? data.disc : d));
		pendingResetId = null;
		delete resetErrors[discId];
	}

	async function dismissPipelineEvent(id: number) {
		const response = await fetch('/api/pipeline-event-dismiss', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pipelineEventId: id })
		});
		if (response.ok) {
			pipelineEvents = pipelineEvents.filter((e) => e.id !== id);
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
		<h1 class="text-2xl font-semibold">Rip Queue</h1>
		{#if pushSupported && !pushEnabled}
			<button
				class="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
				onclick={enablePush}
			>
				Enable notifications
			</button>
		{/if}
	</div>

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

	{#if pipelineEvents.length > 0}
		<section class="space-y-3">
			<h2 class="text-lg font-medium">Recent issues ({pipelineEvents.length})</h2>
			<ul class="space-y-2">
				{#each pipelineEvents as event (event.id)}
					<li
						class="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40"
					>
						<p class="text-sm font-medium">{pipelineEventLabel[event.kind]}</p>
						<p class="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{event.message}</p>
						<p class="mt-1 text-xs text-gray-500">
							{new Date(event.createdAt).toLocaleString()}
						</p>
						<button
							class="mt-2 rounded-md border px-3 py-1 text-sm"
							onclick={() => dismissPipelineEvent(event.id)}
						>
							Dismiss
						</button>
					</li>
				{/each}
			</ul>
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
							{#if isStaleRip(disc, now)}
								<span
									class="mt-1 ml-1 inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200"
									title="No progress update in a while - a single long title can legitimately take hours, but if the disc looks stuck, Reset lets you start over."
								>
									⚠ No update in {formatStaleDuration(now - disc.updatedAt)}
								</span>
							{/if}
							{#if discStore.progressLog[disc.id]?.length}
								<div
									class="mt-1.5 max-w-xs space-y-0.5 rounded-md border border-blue-100 bg-blue-50/60 px-2 py-1.5 dark:border-blue-900 dark:bg-blue-950/40"
								>
									{#each discStore.progressLog[disc.id] as line, i (i)}
										<p
											class="text-xs {i === discStore.progressLog[disc.id].length - 1
												? 'font-medium text-blue-900 dark:text-blue-200'
												: 'text-gray-500 dark:text-gray-400'}"
										>
											{line}
										</p>
									{/each}
								</div>
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
						{:else if pendingResetId === disc.id}
							<div class="flex max-w-xs flex-col items-end gap-1 text-sm">
								<span class="text-right text-gray-500">
									{#if disc.status === 'ripping'}
										Only do this if the rip is actually stuck - if it's genuinely still ripping,
										this will be refused.
									{:else if disc.status === 'staged'}
										The ripped file itself is untouched - you'll just lose rip-progress tracking and
										can re-match it later.
									{:else if disc.mediaType === 'tv'}
										This won't touch the filed episode(s) - if you're redoing this disc, delete its
										old episode file(s) in Jellyfin first, or the re-rip will file as new duplicate
										episode numbers instead of replacing them.
									{:else}
										The filed movie file is untouched - re-ripping will safely overwrite it at the
										same filename.
									{/if}
								</span>
								{#if resetErrors[disc.id]}
									<span class="text-right text-xs text-red-600 dark:text-red-400"
										>{resetErrors[disc.id]}</span
									>
								{/if}
								<div class="flex items-center gap-2">
									<button
										class="rounded-md border border-red-600 px-2 py-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
										onclick={() => resetDisc(disc.id)}
									>
										Confirm reset
									</button>
									<button
										class="rounded-md border px-2 py-1"
										onclick={() => {
											pendingResetId = null;
											delete resetErrors[disc.id];
										}}
									>
										Cancel
									</button>
								</div>
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
									{#if earlierDiscIncomplete(disc)}
										<span
											class="text-xs text-amber-600 dark:text-amber-400"
											title="Ripping out of order can leave TV episode numbering wrong - finish the earlier disc of this title first."
										>
											⚠ Disc {disc.discNumber! - 1}+ not complete yet
										</span>
									{:else}
										<button
											class="rounded-md border px-2 py-1 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
											onclick={() => arm(disc.id)}
										>
											Start ripping
										</button>
									{/if}
								{/if}
								{#if disc.status === 'ripping' || disc.status === 'staged' || disc.status === 'complete'}
									<button
										class="rounded-md border px-2 py-1 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
										onclick={() => (pendingResetId = disc.id)}
									>
										Reset
									</button>
								{/if}
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
