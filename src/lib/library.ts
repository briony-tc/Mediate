import type { Disc, DiscStatus, Ownership, PipelineEventKind } from '$lib/types';

export type SortKey = 'updated' | 'title' | 'year' | 'status';
export type MediaTypeFilter = 'all' | 'movie' | 'tv';
export type StatusFilter = 'all' | DiscStatus;
export type OwnershipFilter = 'all' | Ownership;

const STATUS_ORDER: Record<DiscStatus, number> = {
	not_started: 0,
	ripping: 1,
	staged: 2,
	complete: 3
};

export const statusLabel: Record<DiscStatus, string> = {
	not_started: 'Not started',
	ripping: 'Ripping',
	// 'staged' now means "matched, rip confirmed done, but couldn't be
	// auto-filed into Jellyfin" - auto-filing is near-instant when it works,
	// so this status is now specifically the "needs a look" case.
	staged: 'Needs attention',
	complete: 'Complete'
};

export const statusClass: Record<DiscStatus, string> = {
	not_started: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
	ripping: 'animate-pulse bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
	staged: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
	complete: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
};

export const ownershipLabel: Record<Ownership, string> = {
	owned: 'Owned',
	wanted: 'Wanted',
	digital_only: 'Digital only'
};

export const pipelineEventLabel: Record<PipelineEventKind, string> = {
	rip_needs_review: "Rip finished but couldn't be matched to any disc",
	staging_path_misconfigured: 'Staging path misconfigured',
	jellyfin_path_misconfigured: 'Jellyfin path misconfigured',
	tv_bonus_content_excluded: 'Possible bonus content excluded from episode numbering'
};

// A single-title feature-length rip can legitimately go 1-2+ hours between
// the "started ripping" transition and /api/rip-complete, with zero
// /api/rip-progress pings in between - auto-rip.sh only pings at title-loop
// boundaries (see rip-progress/+server.ts). This threshold is deliberately
// generous and purely informational - it never auto-triggers a reset, unlike
// the much shorter RIPPING_RESET_SAFETY_WINDOW_MS in api/unlink/+server.ts,
// which only cares whether a file handle is open *right now*, not whether an
// hours-long rip is progressing normally.
export const STALE_RIP_THRESHOLD_MS = 3 * 60 * 60 * 1000;

export function isStaleRip(disc: Disc, now: number): boolean {
	return disc.status === 'ripping' && now - disc.updatedAt > STALE_RIP_THRESHOLD_MS;
}

export function formatStaleDuration(ms: number): string {
	const hours = Math.floor(ms / 3_600_000);
	return hours >= 1 ? `${hours}h+` : `${Math.floor(ms / 60_000)}m+`;
}

export function filterDiscs(
	discs: Disc[],
	{
		status,
		mediaType,
		ownership = 'all',
		query
	}: {
		status: StatusFilter;
		mediaType: MediaTypeFilter;
		ownership?: OwnershipFilter;
		query: string;
	}
): Disc[] {
	const needle = query.trim().toLowerCase();
	return discs.filter((disc) => {
		if (status !== 'all' && disc.status !== status) return false;
		if (mediaType !== 'all' && disc.mediaType !== mediaType) return false;
		if (ownership !== 'all' && disc.ownership !== ownership) return false;
		if (needle && !disc.title.toLowerCase().includes(needle)) return false;
		return true;
	});
}

function discGroupKey(disc: Disc): string {
	return `${disc.watchmodeId}:${disc.season ?? ''}`;
}

/**
 * Keeps discs of the same multi-disc title/season (same watchmodeId+season)
 * adjacent and in disc-number order, without disturbing the relative order
 * the sort above already established between different titles/groups. A
 * no-op for every single-disc title, which is still the overwhelming
 * majority - those groups are always length 1.
 */
function groupMultiDiscTitles(discs: Disc[]): Disc[] {
	const groups = new Map<string, Disc[]>();
	const order: string[] = [];
	for (const disc of discs) {
		const key = discGroupKey(disc);
		if (!groups.has(key)) {
			groups.set(key, []);
			order.push(key);
		}
		groups.get(key)!.push(disc);
	}
	return order.flatMap((key) => {
		const group = groups.get(key)!;
		if (group.length < 2) return group;
		return group.slice().sort((a, b) => (a.discNumber ?? 0) - (b.discNumber ?? 0));
	});
}

export function sortDiscs(discs: Disc[], sortKey: SortKey): Disc[] {
	const sorted = discs.slice();
	switch (sortKey) {
		case 'title':
			sorted.sort((a, b) => a.title.localeCompare(b.title));
			break;
		case 'year':
			// Undated titles sort last rather than first (treated as "unknown", not "oldest").
			sorted.sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity));
			break;
		case 'status':
			sorted.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
			break;
		case 'updated':
		default:
			sorted.sort((a, b) => b.updatedAt - a.updatedAt);
			break;
	}
	return groupMultiDiscTitles(sorted);
}

export type StatusCounts = Record<DiscStatus, number> & { total: number };

export function statusCounts(discs: Disc[]): StatusCounts {
	const counts: StatusCounts = {
		not_started: 0,
		ripping: 0,
		staged: 0,
		complete: 0,
		total: discs.length
	};
	for (const disc of discs) {
		counts[disc.status] += 1;
	}
	return counts;
}

export function mediaTypeCounts(discs: Disc[]): { movie: number; tv: number } {
	const counts = { movie: 0, tv: 0 };
	for (const disc of discs) {
		counts[disc.mediaType] += 1;
	}
	return counts;
}

export function ownershipCounts(discs: Disc[]): Record<Ownership, number> {
	const counts: Record<Ownership, number> = { owned: 0, wanted: 0, digital_only: 0 };
	for (const disc of discs) {
		counts[disc.ownership] += 1;
	}
	return counts;
}

export function topGenres(discs: Disc[], limit = 6): { genre: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const disc of discs) {
		if (!disc.genres) continue;
		let names: unknown;
		try {
			names = JSON.parse(disc.genres);
		} catch {
			continue;
		}
		if (!Array.isArray(names)) continue;
		for (const name of names) {
			if (typeof name !== 'string' || !name) continue;
			counts.set(name, (counts.get(name) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.map(([genre, count]) => ({ genre, count }))
		.sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre))
		.slice(0, limit);
}

export type GrowthBucket = { label: string; start: number; count: number };

/**
 * Buckets discs by createdAt into weekly periods (Monday-anchored, UTC) so the
 * chart stays readable regardless of how the collection was scanned in over
 * time. Empty weeks inside the range are included so bars stay evenly spaced;
 * the range is capped to the most recent `maxBuckets` weeks since a
 * years-long tail would otherwise squeeze every bar into illegibility.
 */
export function growthBuckets(discs: Disc[], maxBuckets = 12): GrowthBucket[] {
	if (discs.length === 0) return [];

	const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
	const weekStart = (ms: number) => {
		const date = new Date(ms);
		const day = date.getUTCDay();
		// getUTCDay: 0=Sun..6=Sat; shift so Monday is the start of the week.
		const diffToMonday = (day + 6) % 7;
		const monday = new Date(
			Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - diffToMonday)
		);
		return monday.getTime();
	};

	const earliest = Math.min(...discs.map((d) => d.createdAt));
	const latest = Math.max(...discs.map((d) => d.createdAt));
	const firstWeek = weekStart(earliest);
	const lastWeek = weekStart(latest);

	const totalWeeks = Math.round((lastWeek - firstWeek) / WEEK_MS) + 1;
	const bucketCount = Math.min(totalWeeks, maxBuckets);
	const rangeStart = lastWeek - (bucketCount - 1) * WEEK_MS;

	const buckets = new Map<number, number>();
	for (let i = 0; i < bucketCount; i++) {
		buckets.set(rangeStart + i * WEEK_MS, 0);
	}

	for (const disc of discs) {
		const bucket = weekStart(disc.createdAt);
		if (buckets.has(bucket)) {
			buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
		}
	}

	const formatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
	return [...buckets.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([start, count]) => ({ label: formatter.format(new Date(start)), start, count }));
}
