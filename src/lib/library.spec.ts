import { describe, expect, it } from 'vitest';
import type { Disc } from '$lib/types';
import {
	filterDiscs,
	formatStaleDuration,
	growthBuckets,
	isStaleRip,
	mediaTypeCounts,
	ownershipCounts,
	sortDiscs,
	statusCounts,
	topGenres
} from './library';

function makeDisc(overrides: Partial<Disc> = {}): Disc {
	return {
		id: 1,
		status: 'not_started',
		ownership: 'owned',
		title: 'Inception',
		mediaType: 'movie',
		season: null,
		discNumber: null,
		year: 2010,
		watchmodeId: 1,
		imdbId: null,
		posterUrl: null,
		genres: null,
		barcodeUpc: null,
		rawLookupTitle: null,
		armedAt: null,
		ripTitlesCompleted: null,
		ripTitlesTotal: null,
		stagedPath: null,
		completePath: null,
		stagedAt: null,
		completedAt: null,
		createdAt: 0,
		updatedAt: 0,
		...overrides
	};
}

describe('filterDiscs', () => {
	const discs = [
		makeDisc({ id: 1, title: 'Inception', status: 'not_started', mediaType: 'movie' }),
		makeDisc({ id: 2, title: 'The Vicar of Dibley', status: 'complete', mediaType: 'tv' }),
		makeDisc({ id: 3, title: 'FernGully', status: 'staged', mediaType: 'movie' })
	];

	it('returns everything when filters are "all" and query is empty', () => {
		expect(filterDiscs(discs, { status: 'all', mediaType: 'all', query: '' })).toEqual(discs);
	});

	it('filters by status', () => {
		const result = filterDiscs(discs, { status: 'complete', mediaType: 'all', query: '' });
		expect(result.map((d) => d.id)).toEqual([2]);
	});

	it('filters by media type', () => {
		const result = filterDiscs(discs, { status: 'all', mediaType: 'tv', query: '' });
		expect(result.map((d) => d.id)).toEqual([2]);
	});

	it('filters by case-insensitive title substring', () => {
		const result = filterDiscs(discs, { status: 'all', mediaType: 'all', query: 'vicar' });
		expect(result.map((d) => d.id)).toEqual([2]);
	});

	it('combines all three filters', () => {
		const result = filterDiscs(discs, { status: 'staged', mediaType: 'movie', query: 'fern' });
		expect(result.map((d) => d.id)).toEqual([3]);
	});

	it('filters by ownership, defaulting to "all" when omitted', () => {
		const withOwnership = [
			makeDisc({ id: 1, ownership: 'owned' }),
			makeDisc({ id: 2, ownership: 'wanted' }),
			makeDisc({ id: 3, ownership: 'digital_only' })
		];

		expect(
			filterDiscs(withOwnership, {
				status: 'all',
				mediaType: 'all',
				ownership: 'wanted',
				query: ''
			}).map((d) => d.id)
		).toEqual([2]);
		expect(
			filterDiscs(withOwnership, { status: 'all', mediaType: 'all', query: '' }).map((d) => d.id)
		).toEqual([1, 2, 3]);
	});
});

describe('sortDiscs', () => {
	const discs = [
		makeDisc({ id: 1, title: 'Charlie', year: 2000, status: 'complete', updatedAt: 10 }),
		makeDisc({ id: 2, title: 'Alpha', year: null, status: 'not_started', updatedAt: 30 }),
		makeDisc({ id: 3, title: 'Bravo', year: 1990, status: 'staged', updatedAt: 20 }),
		makeDisc({ id: 4, title: 'Delta', year: 2010, status: 'ripping', updatedAt: 25 })
	];

	it('sorts by title A-Z', () => {
		expect(sortDiscs(discs, 'title').map((d) => d.title)).toEqual([
			'Alpha',
			'Bravo',
			'Charlie',
			'Delta'
		]);
	});

	it('sorts by year descending, with undated titles last', () => {
		expect(sortDiscs(discs, 'year').map((d) => d.id)).toEqual([4, 1, 3, 2]);
	});

	it('sorts by status in workflow order (not_started, ripping, staged, complete)', () => {
		expect(sortDiscs(discs, 'status').map((d) => d.id)).toEqual([2, 4, 3, 1]);
	});

	it('sorts by most recently updated', () => {
		expect(sortDiscs(discs, 'updated').map((d) => d.id)).toEqual([2, 4, 3, 1]);
	});

	it('does not mutate the input array', () => {
		const copy = discs.slice();
		sortDiscs(discs, 'title');
		expect(discs).toEqual(copy);
	});

	it('keeps discs of the same title/season adjacent, ordered by disc number, wherever the group falls', () => {
		const multiDisc = [
			makeDisc({ id: 10, title: 'Zeta', watchmodeId: 99, discNumber: 2, updatedAt: 5 }),
			makeDisc({ id: 11, title: 'Alpha', watchmodeId: 1, updatedAt: 1 }),
			makeDisc({ id: 12, title: 'Zeta', watchmodeId: 99, discNumber: 1, updatedAt: 40 })
		];

		// Sorted by title, "Zeta" (id 12, the earlier-encountered disc-1 group
		// member) anchors the group's position - disc 2 (id 10) follows right
		// after it despite its own title-sort position being identical.
		expect(sortDiscs(multiDisc, 'title').map((d) => d.id)).toEqual([11, 12, 10]);
	});
});

describe('statusCounts', () => {
	it('tallies each status plus a total', () => {
		const discs = [
			makeDisc({ status: 'not_started' }),
			makeDisc({ status: 'not_started' }),
			makeDisc({ status: 'staged' }),
			makeDisc({ status: 'complete' })
		];
		expect(statusCounts(discs)).toEqual({
			not_started: 2,
			ripping: 0,
			staged: 1,
			complete: 1,
			total: 4
		});
	});

	it('returns zeros for an empty library', () => {
		expect(statusCounts([])).toEqual({
			not_started: 0,
			ripping: 0,
			staged: 0,
			complete: 0,
			total: 0
		});
	});
});

describe('mediaTypeCounts', () => {
	it('tallies movies and tv separately', () => {
		const discs = [
			makeDisc({ mediaType: 'movie' }),
			makeDisc({ mediaType: 'tv' }),
			makeDisc({ mediaType: 'tv' })
		];
		expect(mediaTypeCounts(discs)).toEqual({ movie: 1, tv: 2 });
	});
});

describe('ownershipCounts', () => {
	it('tallies owned, wanted, and digital_only separately', () => {
		const discs = [
			makeDisc({ ownership: 'owned' }),
			makeDisc({ ownership: 'owned' }),
			makeDisc({ ownership: 'wanted' }),
			makeDisc({ ownership: 'digital_only' })
		];
		expect(ownershipCounts(discs)).toEqual({ owned: 2, wanted: 1, digital_only: 1 });
	});
});

describe('topGenres', () => {
	it('parses the JSON genres field and ranks by frequency', () => {
		const discs = [
			makeDisc({ genres: JSON.stringify(['Drama', 'Romance']) }),
			makeDisc({ genres: JSON.stringify(['Drama']) }),
			makeDisc({ genres: JSON.stringify(['Comedy']) })
		];
		expect(topGenres(discs)).toEqual([
			{ genre: 'Drama', count: 2 },
			{ genre: 'Comedy', count: 1 },
			{ genre: 'Romance', count: 1 }
		]);
	});

	it('ignores discs with missing or malformed genres', () => {
		const discs = [
			makeDisc({ genres: null }),
			makeDisc({ genres: 'not json' }),
			makeDisc({ genres: JSON.stringify(['Horror']) })
		];
		expect(topGenres(discs)).toEqual([{ genre: 'Horror', count: 1 }]);
	});

	it('respects the limit', () => {
		const discs = ['A', 'B', 'C', 'D'].map((g) => makeDisc({ genres: JSON.stringify([g]) }));
		expect(topGenres(discs, 2)).toHaveLength(2);
	});
});

describe('growthBuckets', () => {
	const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
	// 2026-08-03 is a Monday, used as a stable week anchor for the fixtures.
	const MONDAY = Date.UTC(2026, 7, 3);

	it('returns an empty array for an empty library', () => {
		expect(growthBuckets([])).toEqual([]);
	});

	it('buckets discs into the week they were created', () => {
		const discs = [
			makeDisc({ createdAt: MONDAY }),
			makeDisc({ createdAt: MONDAY + 2 * 24 * 60 * 60 * 1000 }),
			makeDisc({ createdAt: MONDAY + WEEK_MS })
		];
		const buckets = growthBuckets(discs);
		expect(buckets).toHaveLength(2);
		expect(buckets[0].count).toBe(2);
		expect(buckets[1].count).toBe(1);
	});

	it('includes empty weeks inside the range so bars stay evenly spaced', () => {
		const discs = [makeDisc({ createdAt: MONDAY }), makeDisc({ createdAt: MONDAY + 2 * WEEK_MS })];
		const buckets = growthBuckets(discs);
		expect(buckets.map((b) => b.count)).toEqual([1, 0, 1]);
	});

	it('caps the range to the most recent maxBuckets weeks', () => {
		const discs = [makeDisc({ createdAt: MONDAY }), makeDisc({ createdAt: MONDAY + 20 * WEEK_MS })];
		const buckets = growthBuckets(discs, 5);
		expect(buckets).toHaveLength(5);
		expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(1);
	});
});

describe('isStaleRip', () => {
	const now = 10_000_000;

	it('is true for a ripping disc with no update in over 3 hours', () => {
		const disc = makeDisc({ status: 'ripping', updatedAt: now - 4 * 60 * 60 * 1000 });
		expect(isStaleRip(disc, now)).toBe(true);
	});

	it('is false for a ripping disc updated recently', () => {
		const disc = makeDisc({ status: 'ripping', updatedAt: now - 5 * 60 * 1000 });
		expect(isStaleRip(disc, now)).toBe(false);
	});

	it('is false for any other status regardless of how old updatedAt is', () => {
		const disc = makeDisc({ status: 'not_started', updatedAt: now - 4 * 60 * 60 * 1000 });
		expect(isStaleRip(disc, now)).toBe(false);
	});
});

describe('formatStaleDuration', () => {
	it('formats sub-hour durations in minutes', () => {
		expect(formatStaleDuration(45 * 60 * 1000)).toBe('45m+');
	});

	it('formats hour-plus durations in hours', () => {
		expect(formatStaleDuration(3 * 60 * 60 * 1000 + 20 * 60 * 1000)).toBe('3h+');
	});
});
