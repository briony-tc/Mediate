import { sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '../db/client';
import { discs, unmatchedFiles } from '../db/schema';

const testDb = createDb(':memory:');
migrate(testDb, { migrationsFolder: 'drizzle' });

vi.mock('../db', () => ({ db: testDb }));

const { onFileSeen, parseJellyfinPath, parseStagingPath } = await import('./reconcile');

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

describe('parseJellyfinPath', () => {
	it('parses a movie path', () => {
		expect(parseJellyfinPath(['movies', 'Inception (2010)', 'Inception.mkv'].join(sep))).toEqual({
			mediaType: 'movie',
			title: 'Inception (2010)',
			season: null,
			year: 2010
		});
	});

	it('returns a null year for a bare movie folder with no "(Year)" suffix', () => {
		expect(parseJellyfinPath(['movies', 'Inception', 'Inception.mkv'].join(sep))).toEqual({
			mediaType: 'movie',
			title: 'Inception',
			season: null,
			year: null
		});
	});

	it('parses a tv path, extracting the season number', () => {
		expect(parseJellyfinPath(['tv', 'Breaking Bad', 'Season 1', 'S01E01.mkv'].join(sep))).toEqual({
			mediaType: 'tv',
			title: 'Breaking Bad',
			season: 1
		});
	});

	it('recognizes "Series N" and bare "SN" season folder names', () => {
		expect(parseJellyfinPath(['tv', 'Doctor Who', 'Series 2', 'x.mkv'].join(sep))?.season).toBe(2);
		expect(parseJellyfinPath(['tv', 'Breaking Bad', 'S03', 'x.mkv'].join(sep))?.season).toBe(3);
	});

	it('returns a null season when the season folder name is unrecognized', () => {
		expect(parseJellyfinPath(['tv', 'Breaking Bad', 'Disc 1', 'x.mkv'].join(sep))).toEqual({
			mediaType: 'tv',
			title: 'Breaking Bad',
			season: null
		});
	});

	it('returns null for a bare tv show folder with no season segment yet', () => {
		expect(parseJellyfinPath(['tv', 'Breaking Bad'].join(sep))).toBeNull();
	});

	it('returns null for paths outside the movies/tv convention', () => {
		expect(parseJellyfinPath('.DS_Store')).toBeNull();
		expect(parseJellyfinPath('random-file.txt')).toBeNull();
	});
});

describe('parseStagingPath', () => {
	it('treats the top-level folder name as the title, verbatim', () => {
		expect(parseStagingPath('THE_VICAR_OF_DIBLEY_XMAS_SPECIAL')).toEqual({
			title: 'THE_VICAR_OF_DIBLEY_XMAS_SPECIAL'
		});
	});

	it('returns null for anything nested deeper than the top-level rip folder', () => {
		expect(parseStagingPath(['Inception', 'Inception.mkv'].join(sep))).toBeNull();
	});

	it('returns null for the root itself', () => {
		expect(parseStagingPath('')).toBeNull();
	});
});

describe('onFileSeen - staging tree (flat MakeMKV output)', () => {
	it('auto-links an unambiguous clean match and promotes not_started -> ripping', () => {
		const disc = seedDisc({ title: 'Inception', status: 'not_started' });
		const absolute = '/staging/Inception';

		onFileSeen(absolute, 'Inception', 'staging');

		const updated = testDb
			.select()
			.from(discs)
			.all()
			.find((d) => d.id === disc.id);
		expect(updated?.status).toBe('ripping');
		expect(updated?.stagedPath).toBe(absolute);
		expect(testDb.select().from(unmatchedFiles).all()).toHaveLength(0);
	});

	it('matches a messy real-world MakeMKV disc-label folder name', () => {
		const disc = seedDisc({ title: 'FernGully: The Last Rainforest', status: 'not_started' });
		const absolute = '/staging/FERNGULLY_THE_LAST_RAINFOREST';

		onFileSeen(absolute, 'FERNGULLY_THE_LAST_RAINFOREST', 'staging');

		expect(testDb.select().from(discs).all()[0].status).toBe('ripping');
	});

	it('does not auto-link when multiple not_started discs share the same title (ambiguous season)', () => {
		const season1 = seedDisc({ title: 'The Vicar of Dibley', mediaType: 'tv', season: 1 });
		const season2 = seedDisc({ title: 'The Vicar of Dibley', mediaType: 'tv', season: 2 });
		const absolute = '/staging/THE_VICAR_OF_DIBLEY_XMAS_SPECIAL';

		onFileSeen(absolute, 'THE_VICAR_OF_DIBLEY_XMAS_SPECIAL', 'staging');

		const rows = testDb.select().from(discs).all();
		expect(rows.find((d) => d.id === season1.id)?.status).toBe('not_started');
		expect(rows.find((d) => d.id === season2.id)?.status).toBe('not_started');

		const unmatched = testDb.select().from(unmatchedFiles).all();
		expect(unmatched).toHaveLength(1);
		expect(unmatched[0].resolution).toBe('unresolved');
		expect(unmatched[0].bestGuessDiscId).not.toBeNull();
	});

	it('records an unmatched file with a suggestion for a near-miss score', () => {
		seedDisc({ title: 'Inception', status: 'not_started' });

		onFileSeen('/staging/Inception Trailer', 'Inception Trailer', 'staging');

		const rows = testDb.select().from(unmatchedFiles).all();
		expect(rows).toHaveLength(1);
		expect(rows[0].resolution).toBe('unresolved');
		expect(rows[0].bestGuessDiscId).not.toBeNull();
	});

	it('records an unmatched file with no guess when nothing scores above the suggest threshold', () => {
		seedDisc({ title: 'Inception', status: 'not_started' });

		onFileSeen('/staging/Completely Different Movie', 'Completely Different Movie', 'staging');

		const rows = testDb.select().from(unmatchedFiles).all();
		expect(rows).toHaveLength(1);
		expect(rows[0].bestGuessDiscId).toBeNull();
	});

	it('ignores anything nested deeper than the top-level rip folder', () => {
		onFileSeen('/staging/Inception/extras', ['Inception', 'extras'].join(sep), 'staging');
		expect(testDb.select().from(unmatchedFiles).all()).toHaveLength(0);
	});

	describe('armed disc fast path', () => {
		it('links an armed disc unconditionally, even when the folder name does not fuzzy-match its title at all', () => {
			const armed = seedDisc({
				title: 'The Vicar of Dibley',
				status: 'not_started',
				armedAt: Date.now()
			});
			// A completely unrelated-looking MakeMKV volume label - would never
			// fuzzy-match "The Vicar of Dibley" on its own.
			const absolute = '/staging/DISC_4_SIDE_B';

			onFileSeen(absolute, 'DISC_4_SIDE_B', 'staging');

			const updated = testDb
				.select()
				.from(discs)
				.all()
				.find((d) => d.id === armed.id);
			expect(updated?.status).toBe('ripping');
			expect(updated?.stagedPath).toBe(absolute);
			expect(testDb.select().from(unmatchedFiles).all()).toHaveLength(0);
		});

		it('clears armedAt once the armed disc is linked', () => {
			const armed = seedDisc({ status: 'not_started', armedAt: Date.now() });

			onFileSeen('/staging/Anything', 'Anything', 'staging');

			const updated = testDb
				.select()
				.from(discs)
				.all()
				.find((d) => d.id === armed.id);
			expect(updated?.armedAt).toBeNull();
		});

		it('ignores an armed disc that is no longer not_started, falling back to fuzzy matching', () => {
			// Defensive: arming is only ever allowed on a not_started disc via
			// /api/arm, but the fast path should not trust a stale armedAt on a
			// disc that has since moved on.
			seedDisc({ title: 'Completely Different Show', status: 'ripping', armedAt: Date.now() });
			const match = seedDisc({ title: 'Inception', status: 'not_started' });

			onFileSeen('/staging/Inception', 'Inception', 'staging');

			const updated = testDb
				.select()
				.from(discs)
				.all()
				.find((d) => d.id === match.id);
			expect(updated?.status).toBe('ripping');
		});

		it("falls back to today's fuzzy matching when nothing is armed", () => {
			const disc = seedDisc({ title: 'Inception', status: 'not_started' });

			onFileSeen('/staging/Inception', 'Inception', 'staging');

			const updated = testDb
				.select()
				.from(discs)
				.all()
				.find((d) => d.id === disc.id);
			expect(updated?.status).toBe('ripping');
		});
	});
});

describe('onFileSeen - jellyfin tree (movies/tv/season convention)', () => {
	it('promotes staged -> complete when seen in the jellyfin tree', () => {
		const disc = seedDisc({
			status: 'staged',
			stagedPath: '/staging/Inception'
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

	it('re-matches a renamed folder for an already-complete disc instead of flagging it unmatched', () => {
		const disc = seedDisc({
			title: 'Inception',
			status: 'complete',
			completePath: '/jellyfin/movies/Inception/Inception.mkv'
		});
		// e.g. manually renamed on disk to match Jellyfin's "Title (Year)" convention.
		const renamed = '/jellyfin/movies/Inception (2010)/Inception.mkv';

		onFileSeen(renamed, ['movies', 'Inception (2010)', 'Inception.mkv'].join(sep), 'jellyfin');

		const updated = testDb
			.select()
			.from(discs)
			.all()
			.find((d) => d.id === disc.id);
		expect(updated?.status).toBe('complete');
		expect(updated?.completePath).toBe(renamed);
		expect(testDb.select().from(unmatchedFiles).all()).toHaveLength(0);
	});

	it('promotes ripping -> complete when seen in the jellyfin tree', () => {
		// e.g. the automated rip-complete webhook's promoteToJellyfin() failed
		// to run (or hasn't yet) but the file made it into Jellyfin some other way.
		const disc = seedDisc({
			status: 'ripping',
			stagedPath: '/staging/Inception'
		});
		const absolute = '/jellyfin/movies/Inception/Inception.mkv';

		onFileSeen(absolute, ['movies', 'Inception', 'Inception.mkv'].join(sep), 'jellyfin');

		const updated = testDb
			.select()
			.from(discs)
			.all()
			.find((d) => d.id === disc.id);
		expect(updated?.status).toBe('complete');
	});

	it('promotes not_started -> complete directly when content is found in jellyfin without ever being staged', () => {
		// e.g. content ripped/placed before this app existed, scanned in afterward
		const disc = seedDisc({ status: 'not_started' });
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

	it('links a season folder to the matching season row, not other seasons of the same show', () => {
		const season1 = seedDisc({ title: 'Breaking Bad', mediaType: 'tv', season: 1 });
		const season2 = seedDisc({ title: 'Breaking Bad', mediaType: 'tv', season: 2 });
		const absolute = '/jellyfin/tv/Breaking Bad/Season 2';

		onFileSeen(absolute, ['tv', 'Breaking Bad', 'Season 2'].join(sep), 'jellyfin');

		const rows = testDb.select().from(discs).all();
		expect(rows.find((d) => d.id === season2.id)?.status).toBe('complete');
		expect(rows.find((d) => d.id === season1.id)?.status).toBe('not_started');
	});

	it('ignores a bare tv show folder with no season info', () => {
		seedDisc({ title: 'Breaking Bad', mediaType: 'tv', season: 1 });

		onFileSeen('/jellyfin/tv/Breaking Bad', ['tv', 'Breaking Bad'].join(sep), 'jellyfin');

		expect(testDb.select().from(unmatchedFiles).all()).toHaveLength(0);
		expect(testDb.select().from(discs).all()[0].status).toBe('not_started');
	});

	it('ignores paths that do not follow the movies/tv convention', () => {
		onFileSeen('/jellyfin/.DS_Store', '.DS_Store', 'jellyfin');
		expect(testDb.select().from(unmatchedFiles).all()).toHaveLength(0);
	});

	describe('movie year disambiguation', () => {
		it('links a year-suffixed folder to the matching-year disc, not other releases of the same title', () => {
			const version1954 = seedDisc({ title: 'A Star Is Born', mediaType: 'movie', year: 1954 });
			const version2018 = seedDisc({ title: 'A Star Is Born', mediaType: 'movie', year: 2018 });
			const absolute = '/jellyfin/movies/A Star Is Born (2018)/A Star Is Born (2018).mkv';

			onFileSeen(
				absolute,
				['movies', 'A Star Is Born (2018)', 'A Star Is Born (2018).mkv'].join(sep),
				'jellyfin'
			);

			const rows = testDb.select().from(discs).all();
			expect(rows.find((d) => d.id === version2018.id)?.status).toBe('complete');
			expect(rows.find((d) => d.id === version1954.id)?.status).toBe('not_started');
		});

		it('still matches a disc with no stored year when it is the only candidate (renamed-folder case)', () => {
			// e.g. a disc scanned before this convention existed, whose Jellyfin
			// folder later got manually renamed to "Title (Year)" - the disc's own
			// `year` column is still null, but it should still be treated as a
			// plausible candidate rather than excluded.
			const disc = seedDisc({ title: 'Inception', mediaType: 'movie', year: null });
			const absolute = '/jellyfin/movies/Inception (2010)/Inception.mkv';

			onFileSeen(absolute, ['movies', 'Inception (2010)', 'Inception.mkv'].join(sep), 'jellyfin');

			expect(
				testDb
					.select()
					.from(discs)
					.all()
					.find((d) => d.id === disc.id)?.status
			).toBe('complete');
		});
	});
});

describe('onFileSeen - idempotency (applies to both trees)', () => {
	it('is idempotent for a path already linked to a disc', () => {
		const absolute = '/staging/Inception';
		seedDisc({
			title: 'Inception',
			status: 'ripping',
			stagedPath: absolute,
			stagedAt: 123,
			updatedAt: 123
		});

		onFileSeen(absolute, 'Inception', 'staging');

		expect(testDb.select().from(unmatchedFiles).all()).toHaveLength(0);
		const disc = testDb.select().from(discs).all()[0];
		expect(disc.stagedAt).toBe(123);
	});

	it('does not reprocess a path already resolved (linked) in unmatchedFiles', () => {
		const absolute = '/staging/Unknown';
		testDb
			.insert(unmatchedFiles)
			.values({ path: absolute, tree: 'staging', resolution: 'linked' })
			.run();

		onFileSeen(absolute, 'Unknown', 'staging');

		expect(testDb.select().from(unmatchedFiles).all()).toHaveLength(1);
	});

	it('does not reprocess a path already resolved (ignored) in unmatchedFiles', () => {
		const absolute = '/staging/Unknown';
		testDb
			.insert(unmatchedFiles)
			.values({ path: absolute, tree: 'staging', resolution: 'ignored' })
			.run();

		onFileSeen(absolute, 'Unknown', 'staging');

		expect(testDb.select().from(unmatchedFiles).all()).toHaveLength(1);
	});

	it('retries a path still unresolved and auto-links it if it now matches (e.g. after a matching-logic fix)', () => {
		const disc = seedDisc({ title: 'Inception', status: 'not_started' });
		const absolute = '/staging/Inception';
		const [existing] = testDb
			.insert(unmatchedFiles)
			.values({ path: absolute, tree: 'staging', resolution: 'unresolved' })
			.returning()
			.all();

		onFileSeen(absolute, 'Inception', 'staging');

		const updated = testDb
			.select()
			.from(discs)
			.all()
			.find((d) => d.id === disc.id);
		expect(updated?.status).toBe('ripping');
		// the stale unmatched row is cleaned up once it resolves
		expect(
			testDb
				.select()
				.from(unmatchedFiles)
				.all()
				.find((u) => u.id === existing.id)
		).toBeUndefined();
	});

	it('retries a still-unresolved path and refreshes its best guess without duplicating the row', () => {
		const absolute = '/staging/Unknown';
		const [existing] = testDb
			.insert(unmatchedFiles)
			.values({ path: absolute, tree: 'staging', resolution: 'unresolved' })
			.returning()
			.all();

		onFileSeen(absolute, 'Unknown', 'staging');

		const rows = testDb.select().from(unmatchedFiles).all();
		expect(rows).toHaveLength(1);
		expect(rows[0].id).toBe(existing.id);
	});
});
