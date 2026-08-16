<script lang="ts">
	import { onMount } from 'svelte';
	import BarcodeScanner from '$lib/components/BarcodeScanner.svelte';
	import { sessionEntriesToCsv, type ScanSessionEntry } from '$lib/csv';
	import type { Ownership } from '$lib/types';

	const SESSION_STORAGE_KEY = 'mediate:scan-session';

	type Candidate = { id: number; name: string; type: string; year?: number; imdbId?: string };

	let status = $state<'idle' | 'loading' | 'error'>('idle');
	let message = $state('Scan a barcode to get started.');
	let candidates = $state<Candidate[]>([]);
	// Poster previews cost one Watchmode API call per candidate - fetched
	// eagerly for the whole result list so covers just appear, at the cost
	// of burning through the API quota faster than fetching on demand would.
	let previewUrls = $state<Record<number, string | null>>({});
	let previewLoading = $state<Record<number, boolean>>({});
	let currentBarcode = $state<string | null>(null);
	let rawLookupTitle = $state<string | null>(null);
	let manualQuery = $state('');
	let focusSignal = $state(0);

	// TV shows are barcoded/tracked per season, but Watchmode search only
	// returns the series - ask for a season number before confirming one.
	let pendingCandidate = $state<Candidate | null>(null);
	// bind:value on a type="number" input yields a number (or undefined when
	// empty), not a string - don't treat this like a text input's value.
	let seasonInput = $state<number | undefined>(undefined);

	// Set when /api/confirm 409s on a title/season that's already tracked -
	// offers the option to add this as another disc of that same title
	// (e.g. a 2-disc DVD, or a season split across discs) instead of just
	// treating it as a duplicate.
	let discConflict = $state<{ candidate: Candidate; season: number | null } | null>(null);
	let discNumberInput = $state<number | undefined>(2);

	// How many discs to create in one go for a given candidate, e.g. "this is
	// a 3-disc set" - keyed by candidate id so the value survives from the
	// result row into the TV season prompt for the same candidate. Left
	// blank/1 for the (overwhelmingly common) single-disc case.
	let discCountInputs = $state<Record<number, number | undefined>>({});

	// Ownership to record for a given candidate - 'owned' by default, since a
	// barcode scan or manual add is usually a physical disc in hand. Switch to
	// 'wanted' for a wishlist entry with no disc yet, or 'digital_only' for
	// content already acquired (e.g. from the internet) but never physically
	// owned. Keyed by candidate id, same pattern as discCountInputs.
	let ownershipInputs = $state<Record<number, Ownership>>({});

	// Tracks every successful add from the *current* result list, so a single
	// search (e.g. "Toy Story") can add several matching discs one at a time
	// without the list disappearing after the first - it only clears when a
	// new scan or search starts (see handleScan/handleManualSearch).
	let addedEntries = $state<{ id: number; season: number | null }[]>([]);

	// Opt-in session logging - when on, every confirmed candidate (new disc or
	// already-tracked dupe) is logged to sessionEntries regardless of outcome,
	// so a whole scanning session can be exported as a CSV report showing which
	// titles are new to your collection vs. already owned. Persisted to
	// localStorage (not a DB table - this is a client-side scratch log, not
	// data the server needs to know about) specifically so a page refresh -
	// needed occasionally to recover from an unrelated stuck-focus state -
	// doesn't wipe out a real scanning session's worth of logged discs.
	let sessionLoggingEnabled = $state(false);
	let sessionEntries = $state<ScanSessionEntry[]>([]);

	onMount(() => {
		const stored = localStorage.getItem(SESSION_STORAGE_KEY);
		if (!stored) return;
		try {
			const parsed = JSON.parse(stored) as { enabled?: boolean; entries?: ScanSessionEntry[] };
			sessionLoggingEnabled = parsed.enabled ?? false;
			sessionEntries = parsed.entries ?? [];
		} catch {
			// Malformed/foreign localStorage value - ignore and start fresh
			// rather than crash the page over a scratch log.
		}
	});

	$effect(() => {
		localStorage.setItem(
			SESSION_STORAGE_KEY,
			JSON.stringify({ enabled: sessionLoggingEnabled, entries: sessionEntries })
		);
	});

	function logSessionEntries(
		discs: {
			title: string;
			year: number | null;
			mediaType: string;
			season: number | null;
			discNumber: number | null;
			genres: string | null;
			barcodeUpc: string | null;
		}[],
		alreadyOwned: boolean
	) {
		if (!sessionLoggingEnabled) return;
		sessionEntries = [
			...sessionEntries,
			...discs.map((d) => ({
				title: d.title,
				year: d.year,
				mediaType: d.mediaType === 'tv' ? ('tv' as const) : ('movie' as const),
				season: d.season,
				discNumber: d.discNumber,
				genres: d.genres,
				barcodeUpc: d.barcodeUpc,
				alreadyOwned
			}))
		];
	}

	function downloadSessionCsv() {
		const csv = sessionEntriesToCsv(sessionEntries);
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `scan-session-${new Date().toISOString().slice(0, 10)}.csv`;
		link.click();
		URL.revokeObjectURL(url);
	}

	function clearSession() {
		sessionEntries = [];
	}

	function isTv(candidate: Candidate) {
		return candidate.type !== 'movie' && candidate.type !== 'short_film';
	}

	function isAdded(id: number, season: number | null) {
		return addedEntries.some((e) => e.id === id && e.season === season);
	}

	function addedSeasonsFor(id: number): number[] {
		return addedEntries
			.filter((e) => e.id === id && e.season !== null)
			.map((e) => e.season as number)
			.sort((a, b) => a - b);
	}

	function guessSeasonNumber(title: string | null): number | null {
		if (!title) return null;
		const match = title.match(/(?:season|series)\s*0*(\d+)/i);
		return match ? Number(match[1]) : null;
	}

	function resetFlow() {
		candidates = [];
		currentBarcode = null;
		rawLookupTitle = null;
		manualQuery = '';
		pendingCandidate = null;
		seasonInput = undefined;
		discConflict = null;
		discNumberInput = 2;
		discCountInputs = {};
		ownershipInputs = {};
		previewUrls = {};
		previewLoading = {};
		addedEntries = [];
		message = 'Scan a barcode to get started.';
		focusSignal += 1;
	}

	function imdbUrl(imdbId: string) {
		return `https://www.imdb.com/title/${imdbId}/`;
	}

	async function loadPreview(candidate: Candidate) {
		if (candidate.id in previewUrls || previewLoading[candidate.id]) return;
		previewLoading = { ...previewLoading, [candidate.id]: true };

		const { response, data } = await postJson('/api/preview', { watchmodeId: candidate.id });
		previewUrls = {
			...previewUrls,
			[candidate.id]: response.ok ? (data.details?.posterUrl ?? null) : null
		};
		previewLoading = { ...previewLoading, [candidate.id]: false };
	}

	function loadPreviews(list: Candidate[]) {
		for (const candidate of list) {
			loadPreview(candidate);
		}
	}

	async function postJson(url: string, body: unknown) {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		return { response, data: await response.json() };
	}

	async function handleScan(barcode: string) {
		status = 'loading';
		message = `Looking up ${barcode}…`;
		currentBarcode = barcode;
		rawLookupTitle = null;
		candidates = [];
		pendingCandidate = null;
		// Without this, a leftover "is this another disc of the same title?"
		// panel from a previous scan's 409 stays on screen and hides the new
		// results, even though this scan's own candidates did come back
		// correctly - looks exactly like "scanning did nothing".
		discConflict = null;
		addedEntries = [];

		const { response, data } = await postJson('/api/scan', { barcode });

		if (!response.ok) {
			status = 'error';
			message = data.error ?? 'Lookup failed.';
			return;
		}

		rawLookupTitle = data.upcTitle;
		candidates = data.results;
		loadPreviews(candidates);
		status = 'idle';

		if (data.upcUnavailable) {
			message = `Barcode lookup is temporarily unavailable (rate limit reached). Search for the title manually above.`;
		} else if (data.upcTitle === null) {
			message = `No product found for barcode ${barcode}. Search for the title manually above.`;
		} else if (data.results.length === 0) {
			message = `Found "${data.upcTitle}" but no matching title. Search manually above.`;
			manualQuery = data.upcTitle;
		} else {
			message = `Found "${data.upcTitle}" — pick the correct match:`;
		}
	}

	async function handleManualSearch(event: SubmitEvent) {
		event.preventDefault();
		if (!manualQuery.trim()) return;

		status = 'loading';
		message = `Searching for "${manualQuery}"…`;
		currentBarcode = null;
		rawLookupTitle = manualQuery;
		pendingCandidate = null;
		discConflict = null;
		addedEntries = [];

		const { response, data } = await postJson('/api/search', { query: manualQuery });

		if (!response.ok) {
			status = 'error';
			message = data.error ?? 'Search failed.';
			// A completed search (even a failed one) hands focus back to the
			// hidden scanner input - otherwise the next physical barcode scan's
			// keystrokes keep landing in this text box instead, indefinitely,
			// since nothing else naturally returns focus here until a page
			// refresh.
			focusSignal += 1;
			return;
		}

		candidates = data.results;
		loadPreviews(candidates);
		status = 'idle';
		message = candidates.length === 0 ? 'No matches found.' : 'Pick the correct match:';
		focusSignal += 1;
	}

	function selectCandidate(candidate: Candidate) {
		if (isTv(candidate)) {
			pendingCandidate = candidate;
			seasonInput = guessSeasonNumber(rawLookupTitle) ?? undefined;
			return;
		}
		confirmCandidate(
			candidate,
			null,
			null,
			discCountInputs[candidate.id],
			ownershipInputs[candidate.id]
		);
	}

	function confirmPendingSeason() {
		if (!pendingCandidate) return;
		confirmCandidate(
			pendingCandidate,
			seasonInput ?? null,
			null,
			discCountInputs[pendingCandidate.id],
			ownershipInputs[pendingCandidate.id]
		);
	}

	// Clears just the in-progress season prompt after an add, leaving the
	// result list (and any other candidates in it) visible - resetFlow()
	// (which wipes the list) only runs for a brand new scan or search.
	function clearPendingAdd() {
		pendingCandidate = null;
		seasonInput = undefined;
		focusSignal += 1;
	}

	async function confirmCandidate(
		candidate: Candidate,
		season: number | null,
		discNumber: number | null = null,
		discCount: number | undefined = undefined,
		ownership: Ownership | undefined = undefined
	) {
		status = 'loading';

		const { response, data } = await postJson('/api/confirm', {
			watchmodeId: candidate.id,
			barcode: currentBarcode,
			rawLookupTitle,
			season,
			discNumber,
			discCount: discCount && discCount > 1 ? discCount : undefined,
			ownership
		});

		if (response.status === 409) {
			status = 'idle';
			if (discNumber !== null) {
				// Already tried to add this exact disc number - nothing more to offer.
				message = `Disc ${discNumber} of "${candidate.name}"${season ? ` season ${season}` : ''} is already tracked.`;
				discConflict = null;
				return;
			}
			message = `"${candidate.name}"${season ? ` season ${season}` : ''} is already tracked.`;
			discConflict = { candidate, season };
			discNumberInput = 2;
			logSessionEntries([data.disc], true);
			clearPendingAdd();
			return;
		}

		if (!response.ok) {
			status = 'error';
			message = data.error ?? 'Could not save this title.';
			return;
		}

		const ownershipSuffix =
			data.disc.ownership && data.disc.ownership !== 'owned'
				? ` (${data.disc.ownership === 'wanted' ? 'wanted' : 'digital only'})`
				: '';
		const createdDiscs: {
			title: string;
			year: number | null;
			mediaType: string;
			season: number | null;
			discNumber: number | null;
			genres: string | null;
			barcodeUpc: string | null;
		}[] = data.discs ?? [data.disc];
		if (createdDiscs.length > 1) {
			const seasonLabel = season ? ` season ${season}` : '';
			message = `Added "${createdDiscs[0].title}"${seasonLabel} as ${createdDiscs.length} discs (Not started)${ownershipSuffix}.`;
		} else {
			const discLabel = data.disc.discNumber ? ` (disc ${data.disc.discNumber})` : '';
			message = `Added "${data.disc.title}"${data.disc.season ? ` season ${data.disc.season}` : ''}${discLabel} as Not started${ownershipSuffix}.`;
		}
		status = 'idle';
		addedEntries = [...addedEntries, { id: candidate.id, season }];
		logSessionEntries(createdDiscs, false);
		discConflict = null;
		discCountInputs = { ...discCountInputs, [candidate.id]: undefined };
		ownershipInputs = { ...ownershipInputs, [candidate.id]: 'owned' };
		clearPendingAdd();
	}

	function confirmAdditionalDisc() {
		if (!discConflict) return;
		confirmCandidate(discConflict.candidate, discConflict.season, discNumberInput ?? 2);
	}

	function dismissDiscConflict() {
		discConflict = null;
	}
</script>

<BarcodeScanner onScan={handleScan} {focusSignal} />

<div class="mx-auto max-w-xl space-y-6 p-6">
	<h1 class="text-2xl font-semibold">Scan a disc</h1>
	<p class="text-sm text-gray-500">Point the scanner at the barcode — this page is listening.</p>

	<label class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
		<input type="checkbox" bind:checked={sessionLoggingEnabled} />
		Log this session for CSV export (e.g. cataloging a batch of discs)
	</label>

	{#if sessionLoggingEnabled && sessionEntries.length > 0}
		<div class="flex items-center gap-3 rounded-md border p-3 text-sm">
			<span>{sessionEntries.length} disc{sessionEntries.length === 1 ? '' : 's'} logged</span>
			<button
				type="button"
				class="ml-auto rounded-md border px-3 py-1 font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
				onclick={downloadSessionCsv}
			>
				Download CSV
			</button>
			<button type="button" class="rounded-md border px-3 py-1" onclick={clearSession}>
				Clear
			</button>
		</div>
	{/if}

	<form class="flex gap-2" onsubmit={handleManualSearch}>
		<input
			type="text"
			bind:value={manualQuery}
			placeholder="Search by title…"
			class="flex-1 rounded-md border p-2"
			onfocus={(e) => e.currentTarget.select()}
		/>
		<button
			type="submit"
			class="rounded-md border px-4 py-2"
			disabled={status === 'loading' || !manualQuery.trim()}
		>
			Search
		</button>
	</form>

	<div class="flex items-center gap-3">
		<p class="flex-1 rounded-md bg-gray-100 p-3 text-sm dark:bg-gray-800">{message}</p>
		<button
			type="button"
			class="rounded-md border px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
			onclick={resetFlow}
		>
			Reset
		</button>
	</div>

	{#if pendingCandidate}
		<div class="space-y-2 rounded-md border p-3">
			<p class="text-sm">
				Which season is this? <span class="font-medium">{pendingCandidate.name}</span>
			</p>
			<div class="flex gap-2">
				<input
					type="number"
					min="1"
					bind:value={seasonInput}
					placeholder="Season number"
					class="w-32 rounded-md border p-2"
				/>
				<input
					type="number"
					min="1"
					bind:value={discCountInputs[pendingCandidate.id]}
					placeholder="Discs (1)"
					aria-label="Number of discs"
					class="w-28 rounded-md border p-2"
				/>
				<select
					value={ownershipInputs[pendingCandidate.id] ?? 'owned'}
					onchange={(e) =>
						(ownershipInputs = {
							...ownershipInputs,
							[pendingCandidate!.id]: e.currentTarget.value as Ownership
						})}
					aria-label="Ownership"
					class="rounded-md border p-2 text-sm"
				>
					<option value="owned">Owned</option>
					<option value="wanted">Wanted</option>
					<option value="digital_only">Digital only</option>
				</select>
				<button
					class="rounded-md border px-4 py-2"
					onclick={confirmPendingSeason}
					disabled={status === 'loading'}
				>
					Add
				</button>
				<button class="rounded-md border px-4 py-2" onclick={() => (pendingCandidate = null)}>
					Cancel
				</button>
			</div>
		</div>
	{:else if discConflict}
		<div class="space-y-2 rounded-md border p-3">
			<p class="text-sm">
				Is this another disc of the same title? <span class="font-medium"
					>{discConflict.candidate.name}</span
				>
			</p>
			<div class="flex gap-2">
				<input
					type="number"
					min="2"
					bind:value={discNumberInput}
					placeholder="Disc number"
					class="w-32 rounded-md border p-2"
				/>
				<button
					class="rounded-md border px-4 py-2"
					onclick={confirmAdditionalDisc}
					disabled={status === 'loading' || !discNumberInput}
				>
					Add
				</button>
				<button class="rounded-md border px-4 py-2" onclick={dismissDiscConflict}> Dismiss </button>
			</div>
		</div>
	{:else if candidates.length > 0}
		<ul class="space-y-2">
			{#each candidates as candidate (candidate.id)}
				<li class="rounded-md border p-3">
					<div class="flex items-start gap-3">
						{#if previewUrls[candidate.id]}
							<img
								src={previewUrls[candidate.id]}
								alt="Cover art for {candidate.name}"
								class="h-24 w-16 flex-none rounded-sm object-cover"
							/>
						{:else if previewLoading[candidate.id]}
							<div
								class="h-24 w-16 flex-none animate-pulse rounded-sm bg-gray-200 dark:bg-gray-700"
							></div>
						{/if}
						<div class="flex-1">
							<span class="font-medium">{candidate.name}</span>
							{#if candidate.year}<span class="text-gray-500"> ({candidate.year})</span>{/if}
							<span class="block text-xs text-gray-500 uppercase">{candidate.type}</span>
						</div>
					</div>
					<div class="mt-2 flex items-center gap-3 text-xs">
						{#if candidate.imdbId}
							<a
								href={imdbUrl(candidate.imdbId)}
								target="_blank"
								rel="noopener noreferrer"
								class="text-blue-600 underline dark:text-blue-400"
							>
								View on IMDb
							</a>
						{/if}
						{#if candidate.id in previewUrls && previewUrls[candidate.id] === null}
							<span class="text-gray-500">No cover available</span>
						{/if}
						{#if isTv(candidate) && addedSeasonsFor(candidate.id).length > 0}
							<span class="text-gray-500">
								Added: season{addedSeasonsFor(candidate.id).length > 1 ? 's' : ''}
								{addedSeasonsFor(candidate.id).join(', ')}
							</span>
						{/if}
						{#if !isTv(candidate) && isAdded(candidate.id, null)}
							<span class="ml-auto rounded-md border px-3 py-1 font-medium text-gray-500">
								Added ✓
							</span>
						{:else}
							<select
								value={ownershipInputs[candidate.id] ?? 'owned'}
								onchange={(e) =>
									(ownershipInputs = {
										...ownershipInputs,
										[candidate.id]: e.currentTarget.value as Ownership
									})}
								aria-label="Ownership for {candidate.name}"
								class="ml-auto rounded-md border p-1 text-xs"
							>
								<option value="owned">Owned</option>
								<option value="wanted">Wanted</option>
								<option value="digital_only">Digital only</option>
							</select>
							<input
								type="number"
								min="1"
								bind:value={discCountInputs[candidate.id]}
								placeholder="1"
								aria-label="Number of discs for {candidate.name}"
								title="Number of discs (leave blank for 1)"
								class="w-14 rounded-md border p-1 text-xs"
							/>
							<button
								class="rounded-md border px-3 py-1 font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
								onclick={() => selectCandidate(candidate)}
								disabled={status === 'loading'}
							>
								Add
							</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>
