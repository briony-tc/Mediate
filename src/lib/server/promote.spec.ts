import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from './db/client';
import { discs } from './db/schema';

const testDb = createDb(':memory:');
migrate(testDb, { migrationsFolder: 'drizzle' });
vi.mock('./db', () => ({ db: testDb }));

const mockEnv: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const { promoteToJellyfin } = await import('./promote');

let stagingFolder: string;
let jellyfinRoot: string;

function seedDisc(overrides: Partial<typeof discs.$inferInsert> = {}) {
	const [disc] = testDb
		.insert(discs)
		.values({
			title: 'Inception',
			mediaType: 'movie',
			watchmodeId: Math.floor(Math.random() * 1_000_000),
			status: 'staged',
			...overrides
		})
		.returning()
		.all();
	return disc;
}

beforeEach(() => {
	const root = mkdtempSync(join(tmpdir(), 'mls-promote-'));
	stagingFolder = join(root, 'staging-rip');
	jellyfinRoot = join(root, 'jellyfin');
	mkdirSync(stagingFolder, { recursive: true });
	mkdirSync(jellyfinRoot, { recursive: true });
	mockEnv.JELLYFIN_PATH = jellyfinRoot;
});

afterEach(() => {
	rmSync(join(stagingFolder, '..'), { recursive: true, force: true });
	testDb.delete(discs).run();
});

describe('promoteToJellyfin - movies', () => {
	it('moves the single ripped file to movies/<Title>/<Title>.mkv and marks the disc complete', () => {
		writeFileSync(join(stagingFolder, 'title_t00.mkv'), 'x');
		const disc = seedDisc({ title: 'Inception', mediaType: 'movie' });

		promoteToJellyfin(disc, stagingFolder);

		const dest = join(jellyfinRoot, 'movies', 'Inception', 'Inception.mkv');
		expect(readdirSync(join(jellyfinRoot, 'movies', 'Inception'))).toEqual(['Inception.mkv']);

		const updated = testDb.select().from(discs).all()[0];
		expect(updated.status).toBe('complete');
		expect(updated.completePath).toBe(dest);
	});

	it('moves only the largest file and leaves extras behind in staging', () => {
		writeFileSync(join(stagingFolder, 'main.mkv'), 'x'.repeat(100));
		writeFileSync(join(stagingFolder, 'extra.mkv'), 'x');
		const disc = seedDisc({ title: 'Inception', mediaType: 'movie' });

		promoteToJellyfin(disc, stagingFolder);

		expect(readdirSync(join(jellyfinRoot, 'movies', 'Inception'))).toEqual(['Inception.mkv']);
		// staging folder is left in place (not removed) since it isn't empty
		expect(readdirSync(stagingFolder)).toEqual(['extra.mkv']);
	});

	it('sanitizes filesystem-unsafe characters out of the title', () => {
		writeFileSync(join(stagingFolder, 'title_t00.mkv'), 'x');
		const disc = seedDisc({ title: 'Ocean: The Sequel', mediaType: 'movie' });

		promoteToJellyfin(disc, stagingFolder);

		expect(readdirSync(join(jellyfinRoot, 'movies'))).toEqual(['Ocean The Sequel']);
	});
});

describe('promoteToJellyfin - tv', () => {
	it('numbers multiple ripped titles sequentially from E01 in disc/track order', () => {
		writeFileSync(join(stagingFolder, 'title_t00.mkv'), 'x');
		writeFileSync(join(stagingFolder, 'title_t01.mkv'), 'x');
		const disc = seedDisc({ title: 'Breaking Bad', mediaType: 'tv', season: 1 });

		promoteToJellyfin(disc, stagingFolder);

		const seasonDir = join(jellyfinRoot, 'tv', 'Breaking Bad', 'Season 1');
		expect(readdirSync(seasonDir).sort()).toEqual([
			'Breaking Bad - S01E01.mkv',
			'Breaking Bad - S01E02.mkv'
		]);

		const updated = testDb.select().from(discs).all()[0];
		expect(updated.status).toBe('complete');
		expect(updated.completePath).toBe(seasonDir);
	});

	it('does nothing and leaves the disc untouched when the disc has no season', () => {
		writeFileSync(join(stagingFolder, 'title_t00.mkv'), 'x');
		const disc = seedDisc({ title: 'Breaking Bad', mediaType: 'tv', season: null });

		promoteToJellyfin(disc, stagingFolder);

		expect(readdirSync(stagingFolder)).toEqual(['title_t00.mkv']);
		expect(testDb.select().from(discs).all()[0].status).toBe('staged');
	});
});

describe('promoteToJellyfin - no rippable files', () => {
	it('does nothing when the staging folder has no .mkv files', () => {
		writeFileSync(join(stagingFolder, 'readme.txt'), 'x');
		const disc = seedDisc({ title: 'Inception', mediaType: 'movie' });

		promoteToJellyfin(disc, stagingFolder);

		expect(readdirSync(stagingFolder)).toEqual(['readme.txt']);
		expect(testDb.select().from(discs).all()[0].status).toBe('staged');
	});
});
