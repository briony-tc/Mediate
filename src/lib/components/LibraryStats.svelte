<script lang="ts">
	import type { Disc } from '$lib/types';
	import { growthBuckets, mediaTypeCounts, statusCounts, topGenres } from '$lib/library';

	let { discs }: { discs: Disc[] } = $props();

	let counts = $derived(statusCounts(discs));
	let media = $derived(mediaTypeCounts(discs));
	let genres = $derived(topGenres(discs));
	let weeks = $derived(growthBuckets(discs));
	let maxWeekCount = $derived(Math.max(1, ...weeks.map((w) => w.count)));
	let maxGenreCount = $derived(Math.max(1, ...genres.map((g) => g.count)));

	function pct(n: number, total: number) {
		return total === 0 ? 0 : Math.round((n / total) * 100);
	}

	const progressSegments = $derived(
		[
			{ key: 'not_started', label: 'Not started', count: counts.not_started, color: 'var(--status-neutral)' },
			{ key: 'staged', label: 'Staged', count: counts.staged, color: 'var(--status-warning)' },
			{ key: 'complete', label: 'Complete', count: counts.complete, color: 'var(--status-good)' }
		].filter((s) => s.count > 0)
	);

	const mediaSegments = $derived(
		[
			{ key: 'movie', label: 'Movies', count: media.movie, color: 'var(--series-blue)' },
			{ key: 'tv', label: 'TV', count: media.tv, color: 'var(--series-orange)' }
		].filter((s) => s.count > 0)
	);

	const genreColors = [
		'var(--series-blue)',
		'var(--series-orange)',
		'var(--series-aqua)',
		'var(--series-yellow)',
		'var(--series-magenta)',
		'var(--series-green)'
	];
</script>

<div class="viz-root space-y-6 rounded-md border p-4">
	{#if counts.total === 0}
		<p class="text-sm text-gray-500">Stats will appear once you've scanned a few discs.</p>
	{:else}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
			<div>
				<p class="text-2xl font-semibold">{counts.total}</p>
				<p class="text-xs text-gray-500">Total discs</p>
			</div>
			<div>
				<p class="text-2xl font-semibold">{counts.not_started}</p>
				<p class="text-xs text-gray-500">Not started</p>
			</div>
			<div>
				<p class="text-2xl font-semibold">{counts.staged}</p>
				<p class="text-xs text-gray-500">Staged</p>
			</div>
			<div>
				<p class="text-2xl font-semibold">{counts.complete}</p>
				<p class="text-xs text-gray-500">Complete</p>
			</div>
		</div>

		<div class="space-y-2">
			<p class="text-sm font-medium">Migration progress</p>
			<div class="flex h-6 w-full overflow-hidden rounded-[4px] bg-[var(--chart-surface)]" role="img"
				aria-label="Migration progress: {progressSegments.map((s) => `${s.label} ${s.count}`).join(', ')}">
				{#each progressSegments as segment, i (segment.key)}
					<button
						type="button"
						class="group relative h-full border-0 p-0"
						class:rounded-l-[4px]={i === 0}
						class:rounded-r-[4px]={i === progressSegments.length - 1}
						style="width: {pct(segment.count, counts.total)}%; background: {segment.color}; margin-left: {i > 0
							? '2px'
							: '0'};"
						aria-label="{segment.label}: {segment.count} ({pct(segment.count, counts.total)}%)"
					>
						<div
							aria-hidden="true"
							class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 rounded-md bg-[var(--tooltip-bg)] px-2 py-1 text-xs whitespace-nowrap text-[var(--tooltip-text)] opacity-0 group-hover:opacity-100 group-focus:opacity-100"
						>
							{segment.label}: {segment.count} ({pct(segment.count, counts.total)}%)
						</div>
					</button>
				{/each}
			</div>
			<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
				{#each progressSegments as segment (segment.key)}
					<span class="flex items-center gap-1.5">
						<span class="inline-block h-2.5 w-2.5 rounded-full" style="background: {segment.color}"></span>
						{segment.label}: {segment.count} ({pct(segment.count, counts.total)}%)
					</span>
				{/each}
			</div>
		</div>

		{#if mediaSegments.length > 0}
			<div class="space-y-2">
				<p class="text-sm font-medium">Movies vs TV</p>
				<div class="flex h-6 w-full overflow-hidden rounded-[4px] bg-[var(--chart-surface)]" role="img"
					aria-label="Media type: {mediaSegments.map((s) => `${s.label} ${s.count}`).join(', ')}">
					{#each mediaSegments as segment, i (segment.key)}
						<button
							type="button"
							class="group relative h-full border-0 p-0"
							class:rounded-l-[4px]={i === 0}
							class:rounded-r-[4px]={i === mediaSegments.length - 1}
							style="width: {pct(segment.count, counts.total)}%; background: {segment.color}; margin-left: {i > 0
								? '2px'
								: '0'};"
							aria-label="{segment.label}: {segment.count} ({pct(segment.count, counts.total)}%)"
						>
							<div
								aria-hidden="true"
								class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 rounded-md bg-[var(--tooltip-bg)] px-2 py-1 text-xs whitespace-nowrap text-[var(--tooltip-text)] opacity-0 group-hover:opacity-100 group-focus:opacity-100"
							>
								{segment.label}: {segment.count} ({pct(segment.count, counts.total)}%)
							</div>
						</button>
					{/each}
				</div>
				<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
					{#each mediaSegments as segment (segment.key)}
						<span class="flex items-center gap-1.5">
							<span class="inline-block h-2.5 w-2.5 rounded-full" style="background: {segment.color}"></span>
							{segment.label}: {segment.count}
						</span>
					{/each}
				</div>
			</div>
		{/if}

		{#if genres.length > 0}
			<div class="space-y-2">
				<p class="text-sm font-medium">Top genres</p>
				<div class="space-y-1.5">
					{#each genres as genre, i (genre.genre)}
						<div class="flex items-center gap-2 text-xs">
							<span class="w-24 flex-none truncate text-gray-500">{genre.genre}</span>
							<div class="h-4 flex-1 overflow-hidden rounded-[4px] bg-[var(--chart-surface)]">
								<div
									class="h-full rounded-[4px]"
									style="width: {pct(genre.count, maxGenreCount)}%; background: {genreColors[i % genreColors.length]};"
								></div>
							</div>
							<span class="w-6 flex-none text-right text-gray-500">{genre.count}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if weeks.length > 1}
			<div class="space-y-2">
				<p class="text-sm font-medium">Discs added per week</p>
				<div class="flex h-20 items-end gap-1">
					{#each weeks as week (week.start)}
						<button
							type="button"
							class="group relative flex h-full flex-1 items-end border-0 bg-transparent p-0"
							aria-label="Week of {week.label}: {week.count}"
						>
							<div
								class="mx-auto rounded-t-[4px] bg-[var(--series-blue)]"
								style="height: {Math.max(2, (week.count / maxWeekCount) * 100)}%; width: min(24px, 100%);"
							></div>
							<div
								aria-hidden="true"
								class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 rounded-md bg-[var(--tooltip-bg)] px-2 py-1 text-xs whitespace-nowrap text-[var(--tooltip-text)] opacity-0 group-hover:opacity-100 group-focus:opacity-100"
							>
								Week of {week.label}: {week.count}
							</div>
						</button>
					{/each}
				</div>
				<div class="flex gap-1 text-[10px] text-gray-500">
					{#each weeks as week (week.start)}
						<span class="flex-1 truncate text-center">{week.label}</span>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.viz-root {
		--series-blue: #2a78d6;
		--series-orange: #eb6834;
		--series-aqua: #1baf7a;
		--series-yellow: #eda100;
		--series-magenta: #e87ba4;
		--series-green: #008300;
		--status-good: #0ca30c;
		--status-warning: #fab219;
		--status-neutral: #9ca3af;
		--chart-surface: #f3f4f6;
		--tooltip-bg: #0b0b0b;
		--tooltip-text: #ffffff;
	}
	@media (prefers-color-scheme: dark) {
		.viz-root {
			--series-blue: #3987e5;
			--series-orange: #d95926;
			--series-aqua: #199e70;
			--series-yellow: #c98500;
			--series-magenta: #d55181;
			--series-green: #008300;
			--chart-surface: #2c2c2a;
			--tooltip-bg: #ffffff;
			--tooltip-text: #0b0b0b;
		}
	}
</style>
