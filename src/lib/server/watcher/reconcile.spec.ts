import { sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '../db/client';
import { discs, unmatchedFiles } from '../db/schema';

const testDb = createDb(':memory:');
migrate(testDb, { migrationsFolder: 'drizzle' });

vi.mock('../db', () => ({ db: testDb }));

const { onFileSeen, parseMediaPath } = await import('./reconcile');

function seedDisc(overrides: Partial<typeof discs.$inferInsert> = {}) {
	const [disc] = testDb
		.insert(discs)
		.values({
			title: 'Inception',
			mediaType: 'movie',
			watchmodeId: Math.floor(Math.random() * 1_000_000),
			...overrides
		})
		.returning()
		.all();
	return disc;
}

afterEach(() => {
	testDb.delete(unmatchedFiles).run();
	testDb.delete(discs).run();
});

describe('parseMediaPath', () => {
	it('parses a movie path', () => {
		expect(parseMediaPath(['movies', 'Inception (2010)', 'Inception.mkv'].join(sep))).toEqual({
			mediaType: 'movie',
			title: 'Inception (2010)',
			season: null
		});
	});

	it('parses a tv path, extracting the season number', () => {
		expect(parseMediaPath(['tv', 'Breaking Bad', 'Season 1', 'S01E01.mkv'].join(sep))).toEqual({
			mediaType: 'tv',
			title: 'Breaking Bad',
			season: 1
		});
	});

	it('recognizes "Series N" and bare "SN" season folder names', () => {
		expect(parseMediaPath(['tv', 'Doctor Who', 'Series 2', 'x.mkv'].join(sep))?.season).toBe(2);
		expect(parseMediaPath(['tv', 'Breaking Bad', 'S03', 'x.mkv'].join(sep))?.season).toBe(3);
	});

	it('returns a null season when the season folder name is unrecognized', () => {
		expect(parseMediaPath(['tv', 'Breaking Bad', 'Disc 1', 'x.mkv'].join(sep))).toEqual({
			mediaType: 'tv',
			title: 'Breaking Bad',
			season: null
		});
	});

	it('returns null for a bare tv show folder with no season segment yet', () => {
		expect(parseMediaPath(['tv', 'Breaking Bad'].join(sep))).toBeNull();
	});

	it('returns null for paths outside the movies/tv convention', () => {
		expect(parseMediaPath('.DS_Store')).toBeNull();
		expect(parseMediaPath('random-file.txt')).toBeNull();
	});
});

describe('onFileSeen', () => {
	it('auto-links a clean match and promotes not_started -> staged', () => {
		const disc = seedDisc({ status: 'not_started' });
		const absolute = '/staging/movies/Inception/Inception.mkv';

		onFileSeen(absolute, ['movies', 'Inception', 'Inception.mkv'].join(sep), 'staging');

		const updated = testDb
			.select()
			.from(discs)
			.all()
			.find((d) => d.id === disc.id);
		expect(updated?.status).toBe('staged');
		expect(updated?.stagedPath).toBe(absolute);
		expect(testDb.select().from(unmatchedFiles).all()).toHaveLength(0);
	});

	it('promotes staged -> complete when seen in the jellyfin tree', () => {
		const disc = seedDisc({
			status: 'staged',
			stagedPath: '/staging/movies/Inception/Inception.mkv'
		});
		const absolute = '/jellyfin/movies/Inception/Inception.mkv';

		onFileSeen(absolute, ['movies', 'Inception', 'Inception.mkv'].join(sep), 'jellyfin');

		const updated = testDb
			.select()
			.from(discs)
			.all()
			.find((d) => d.id === disc.id);
		expect(updated?.status).toBe('complete');
		expect(updated?.completePath).toBe(absolute);
	});

	it('records an unmatched file with a suggestion for a near-miss score', () => {
		seedDisc({ title: 'Inception', status: 'not_started' });
		const absolute = '/staging/movies/Inception Trailer/Inception Trailer.mkv';

		onFileSeen(absolute, ['movies', 'Inception Trailer', 'x.mkv'].join(sep), 'staging');

		const rows = testDb.select().from(unmatchedFiles).all();
		expect(rows).toHaveLength(1);
		expect(rows[0].resolution).toBe('unresolved');
		expect(rows[0].bestGuessDiscId).not.toBeNull();
	});

	it('records an unmatched file with no guess when nothing scores above the suggest threshold', () => {
		seedDisc({ title: 'Inception', status: 'not_started' });
		const absolute = '/staging/movies/Completely Different Movie/x.mkv';

		onFileSeen(absolute, ['movies', 'Completely Different Movie', 'x.mkv'].join(sep), 'staging');

		const rows = testDb.select().from(unmatchedFiles).all();
		expect(rows).toHaveLength(1);
		expect(rows[0].bestGuessDiscId).toBeNull();
	});

	it('ignores paths that do not follow the movies/tv convention', () => {
		onFileSeen('/staging/.DS_Store', '.DS_Store', 'staging');
		expect(testDb.select().from(unmatchedFiles).all()).toHaveLength(0);
	});

	it('is idempotent for a path already linked to a disc', () => {
		const absolute = '/staging/movies/Inception/Inception.mkv';
		seedDisc({ status: 'staged', stagedPath: absolute, stagedAt: 123, updatedAt: 123 });

		onFileSeen(absolute, ['movies', 'Inception', 'Inception.mkv'].join(sep), 'staging');

		expect(testDb.select().from(unmatchedFiles).all()).toHaveLength(0);
		const disc = testDb.select().from(discs).all()[0];
		expect(disc.stagedAt).toBe(123);
	});

	it('does not reprocess a path already recorded in unmatchedFiles', () => {
		const absolute = '/staging/movies/Unknown/x.mkv';
		testDb.insert(unmatchedFiles).values({ path: absolute, tree: 'staging' }).run();

		onFileSeen(absolute, ['movies', 'Unknown', 'x.mkv'].join(sep), 'staging');

		expect(testDb.select().from(unmatchedFiles).all()).toHaveLength(1);
	});

	it('links a season folder to the matching season row, not other seasons of the same show', () => {
		const season1 = seedDisc({ title: 'Breaking Bad', mediaType: 'tv', season: 1 });
		const season2 = seedDisc({ title: 'Breaking Bad', mediaType: 'tv', season: 2 });
		const absolute = '/staging/tv/Breaking Bad/Season 2';

		onFileSeen(absolute, ['tv', 'Breaking Bad', 'Season 2'].join(sep), 'staging');

		const rows = testDb.select().from(discs).all();
		expect(rows.find((d) => d.id === season2.id)?.status).toBe('staged');
		expect(rows.find((d) => d.id === season1.id)?.status).toBe('not_started');
	});

	it('ignores a bare tv show folder with no season info', () => {
		seedDisc({ title: 'Breaking Bad', mediaType: 'tv', season: 1 });

		onFileSeen('/staging/tv/Breaking Bad', ['tv', 'Breaking Bad'].join(sep), 'staging');

		expect(testDb.select().from(unmatchedFiles).all()).toHaveLength(0);
		expect(testDb.select().from(discs).all()[0].status).toBe('not_started');
	});
});
