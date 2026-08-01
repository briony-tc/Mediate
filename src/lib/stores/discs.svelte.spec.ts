import { describe, expect, it } from 'vitest';
import type { Disc } from '$lib/types';
import { mergeEvent } from './discs.svelte';

function makeDisc(overrides: Partial<Disc> = {}): Disc {
	return {
		id: 1,
		status: 'not_started',
		title: 'Inception',
		mediaType: 'movie',
		season: null,
		year: 2010,
		watchmodeId: 1,
		imdbId: null,
		posterUrl: null,
		genres: null,
		barcodeUpc: null,
		rawLookupTitle: null,
		stagedPath: null,
		completePath: null,
		stagedAt: null,
		completedAt: null,
		createdAt: 0,
		updatedAt: 0,
		...overrides
	};
}

describe('mergeEvent', () => {
	it('patches the matching disc with the event status and paths', () => {
		const discs = [makeDisc({ id: 1 }), makeDisc({ id: 2 })];

		const result = mergeEvent(discs, {
			discId: 1,
			status: 'staged',
			stagedPath: '/staging/movies/Inception',
			updatedAt: 999
		});

		expect(result[0]).toMatchObject({
			id: 1,
			status: 'staged',
			stagedPath: '/staging/movies/Inception',
			updatedAt: 999
		});
		expect(result[1]).toEqual(discs[1]);
	});

	it('leaves the list untouched for an unknown discId', () => {
		const discs = [makeDisc({ id: 1 })];

		const result = mergeEvent(discs, { discId: 999, status: 'staged', updatedAt: 1 });

		expect(result).toEqual(discs);
	});

	it('does not mutate the original array', () => {
		const discs = [makeDisc({ id: 1 })];

		mergeEvent(discs, { discId: 1, status: 'staged', updatedAt: 1 });

		expect(discs[0].status).toBe('not_started');
	});
});
