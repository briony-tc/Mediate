import { describe, expect, it } from 'vitest';
import type { Disc } from '$lib/types';
import { appendProgressLog, formatProgressLine, mergeEvent } from './discs.svelte';

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

describe('formatProgressLine', () => {
	it('describes the title currently being ripped', () => {
		expect(formatProgressLine(0, 3)).toBe('Ripping title 1 of 3');
		expect(formatProgressLine(2, 3)).toBe('Ripping title 3 of 3');
	});

	it('shows a completion line once every title is done', () => {
		expect(formatProgressLine(3, 3)).toBe('All 3 titles ripped');
	});
});

describe('appendProgressLog', () => {
	it('appends a formatted line for a disc not seen before', () => {
		const discs = [makeDisc({ id: 1 })];

		const log = appendProgressLog({}, discs, {
			discId: 1,
			status: 'ripping',
			ripTitlesCompleted: 0,
			ripTitlesTotal: 3,
			updatedAt: 1
		});

		expect(log[1]).toEqual(['Ripping title 1 of 3']);
	});

	it('ignores an event with no title-count info', () => {
		const discs = [makeDisc({ id: 1 })];

		const log = appendProgressLog({}, discs, { discId: 1, status: 'ripping', updatedAt: 1 });

		expect(log).toEqual({});
	});

	it('does not add a duplicate line when the counts have not actually changed', () => {
		const discs = [makeDisc({ id: 1, ripTitlesCompleted: 1, ripTitlesTotal: 3 })];
		const existing = { 1: ['Ripping title 2 of 3'] };

		const log = appendProgressLog(existing, discs, {
			discId: 1,
			status: 'ripping',
			ripTitlesCompleted: 1,
			ripTitlesTotal: 3,
			updatedAt: 2
		});

		expect(log[1]).toEqual(['Ripping title 2 of 3']);
	});

	it('caps the log to the most recent 20 entries', () => {
		const discs = [makeDisc({ id: 1 })];
		let log: Record<number, string[]> = { 1: Array.from({ length: 20 }, (_, i) => `line ${i}`) };

		log = appendProgressLog(log, discs, {
			discId: 1,
			status: 'ripping',
			ripTitlesCompleted: 5,
			ripTitlesTotal: 10,
			updatedAt: 1
		});

		expect(log[1]).toHaveLength(20);
		expect(log[1][19]).toBe('Ripping title 6 of 10');
		expect(log[1][0]).toBe('line 1');
	});
});
