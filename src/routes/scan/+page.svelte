<script lang="ts">
	import BarcodeScanner from '$lib/components/BarcodeScanner.svelte';

	type Candidate = { id: number; name: string; type: string; year?: number; imdbId?: string };

	let status = $state<'idle' | 'loading' | 'error'>('idle');
	let message = $state('Scan a barcode to get started.');
	let candidates = $state<Candidate[]>([]);
	let currentBarcode = $state<string | null>(null);
	let rawLookupTitle = $state<string | null>(null);
	let manualQuery = $state('');
	let focusSignal = $state(0);

	function resetFlow() {
		candidates = [];
		currentBarcode = null;
		rawLookupTitle = null;
		manualQuery = '';
		focusSignal += 1;
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

		const { response, data } = await postJson('/api/scan', { barcode });

		if (!response.ok) {
			status = 'error';
			message = data.error ?? 'Lookup failed.';
			return;
		}

		rawLookupTitle = data.upcTitle;
		candidates = data.results;
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

		const { response, data } = await postJson('/api/search', { query: manualQuery });

		if (!response.ok) {
			status = 'error';
			message = data.error ?? 'Search failed.';
			return;
		}

		candidates = data.results;
		status = 'idle';
		message = candidates.length === 0 ? 'No matches found.' : 'Pick the correct match:';
	}

	async function confirmCandidate(candidate: Candidate) {
		status = 'loading';

		const { response, data } = await postJson('/api/confirm', {
			watchmodeId: candidate.id,
			barcode: currentBarcode,
			rawLookupTitle
		});

		if (response.status === 409) {
			message = `"${candidate.name}" is already tracked.`;
			status = 'idle';
			resetFlow();
			return;
		}

		if (!response.ok) {
			status = 'error';
			message = data.error ?? 'Could not save this title.';
			return;
		}

		message = `Added "${data.disc.title}" as Not started.`;
		status = 'idle';
		resetFlow();
	}
</script>

<BarcodeScanner onScan={handleScan} {focusSignal} />

<div class="mx-auto max-w-xl space-y-6 p-6">
	<h1 class="text-2xl font-semibold">Scan a disc</h1>
	<p class="text-sm text-gray-500">Point the scanner at the barcode — this page is listening.</p>

	<p class="rounded-md bg-gray-100 p-3 text-sm dark:bg-gray-800">{message}</p>

	{#if candidates.length > 0}
		<ul class="space-y-2">
			{#each candidates as candidate (candidate.id)}
				<li>
					<button
						class="w-full rounded-md border p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
						onclick={() => confirmCandidate(candidate)}
						disabled={status === 'loading'}
					>
						<span class="font-medium">{candidate.name}</span>
						{#if candidate.year}<span class="text-gray-500"> ({candidate.year})</span>{/if}
						<span class="block text-xs text-gray-500 uppercase">{candidate.type}</span>
					</button>
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
