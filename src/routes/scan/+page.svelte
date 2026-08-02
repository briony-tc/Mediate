<script lang="ts">
	import BarcodeScanner from '$lib/components/BarcodeScanner.svelte';

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

	function isTv(candidate: Candidate) {
		return candidate.type !== 'movie' && candidate.type !== 'short_film';
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
		previewUrls = {};
		previewLoading = {};
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

		if (data.upcTitle === null) {
			message = `No product found for barcode ${barcode}. Search for the title manually below.`;
		} else if (data.results.length === 0) {
			message = `Found "${data.upcTitle}" but no matching title. Search manually below.`;
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

		const { response, data } = await postJson('/api/search', { query: manualQuery });

		if (!response.ok) {
			status = 'error';
			message = data.error ?? 'Search failed.';
			return;
		}

		candidates = data.results;
		loadPreviews(candidates);
		status = 'idle';
		message = candidates.length === 0 ? 'No matches found.' : 'Pick the correct match:';
	}

	function selectCandidate(candidate: Candidate) {
		if (isTv(candidate)) {
			pendingCandidate = candidate;
			seasonInput = guessSeasonNumber(rawLookupTitle) ?? undefined;
			return;
		}
		confirmCandidate(candidate, null);
	}

	function confirmPendingSeason() {
		if (!pendingCandidate) return;
		confirmCandidate(pendingCandidate, seasonInput ?? null);
	}

	async function confirmCandidate(candidate: Candidate, season: number | null) {
		status = 'loading';

		const { response, data } = await postJson('/api/confirm', {
			watchmodeId: candidate.id,
			barcode: currentBarcode,
			rawLookupTitle,
			season
		});

		if (response.status === 409) {
			message = `"${candidate.name}"${season ? ` season ${season}` : ''} is already tracked.`;
			status = 'idle';
			resetFlow();
			return;
		}

		if (!response.ok) {
			status = 'error';
			message = data.error ?? 'Could not save this title.';
			return;
		}

		message = `Added "${data.disc.title}"${data.disc.season ? ` season ${data.disc.season}` : ''} as Not started.`;
		status = 'idle';
		resetFlow();
	}
</script>

<BarcodeScanner onScan={handleScan} {focusSignal} />

<div class="mx-auto max-w-xl space-y-6 p-6">
	<h1 class="text-2xl font-semibold">Scan a disc</h1>
	<p class="text-sm text-gray-500">Point the scanner at the barcode — this page is listening.</p>

	<p class="rounded-md bg-gray-100 p-3 text-sm dark:bg-gray-800">{message}</p>

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
						<button
							class="ml-auto rounded-md border px-3 py-1 font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
							onclick={() => selectCandidate(candidate)}
							disabled={status === 'loading'}
						>
							Add
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<form class="flex gap-2" onsubmit={handleManualSearch}>
		<input
			type="text"
			bind:value={manualQuery}
			placeholder="Search by title…"
			class="flex-1 rounded-md border p-2"
		/>
		<button
			type="submit"
			class="rounded-md border px-4 py-2"
			disabled={status === 'loading' || !manualQuery.trim()}
		>
			Search
		</button>
	</form>
</div>
