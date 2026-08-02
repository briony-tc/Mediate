import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '../db/client';
import { discs, unmatchedFiles } from '../db/schema';

const testDb = createDb(':memory:');
migrate(testDb, { migrationsFolder: 'drizzle' });
vi.mock('../db', () => ({ db: testDb }));

const mockEnv: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const { startWatcher, stopWatcher } = await import('./watcher');

let stagingRoot: string;
let jellyfinRoot: string;

function waitFor(predicate: () => boolean, timeoutMs = 3000, intervalMs = 50): Promise<void> {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		const tick = () => {
			if (predicate()) return resolve();
			if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'));
			setTimeout(tick, intervalMs);
		};
		tick();
	});
}

beforeEach(() => {
	stagingRoot = mkdtempSync(join(tmpdir(), 'mls-staging-'));
	jellyfinRoot = mkdtempSync(join(tmpdir(), 'mls-jellyfin-'));
	// Staging is flat (see parseStagingPath) - a placeholder keeps the root
	// non-empty so the misconfiguration heuristic doesn't fire by default.
	writeFileSync(join(stagingRoot, '.keep'), '');
	mkdirSync(join(jellyfinRoot, 'movies'), { recursive: true });
	mockEnv.STAGING_PATH = stagingRoot;
	mockEnv.JELLYFIN_PATH = jellyfinRoot;
});

afterEach(async () => {
	await stopWatcher();
	rmSync(stagingRoot, { recursive: true, force: true });
	rmSync(jellyfinRoot, { recursive: true, force: true });
	testDb.delete(unmatchedFiles).run();
	testDb.delete(discs).run();
});

describe('watcher', () => {
	it('detects an existing staging folder at startup and auto-links a matching disc', async () => {
		const [disc] = testDb
			.insert(discs)
			.values({ title: 'Inception', mediaType: 'movie', watchmodeId: 1 })
			.returning()
			.all();
		mkdirSync(join(stagingRoot, 'Inception'));

		startWatcher();

		await waitFor(() => {
			const row = testDb
				.select()
				.from(discs)
				.all()
				.find((d) => d.id === disc.id);
			return row?.status === 'staged';
		});

		const updated = testDb
			.select()
			.from(discs)
			.all()
			.find((d) => d.id === disc.id);
		expect(updated?.stagedPath).toBe(join(stagingRoot, 'Inception'));
	});

	it('detects a staging folder added live after startup', async () => {
		const [disc] = testDb
			.insert(discs)
			.values({ title: 'The Matrix', mediaType: 'movie', watchmodeId: 2 })
			.returning()
			.all();

		startWatcher();
		await new Promise((resolve) => setTimeout(resolve, 300));

		mkdirSync(join(stagingRoot, 'The Matrix'));

		await waitFor(() => {
			const row = testDb
				.select()
				.from(discs)
				.all()
				.find((d) => d.id === disc.id);
			return row?.status === 'staged';
		});

		const updated = testDb
			.select()
			.from(discs)
			.all()
			.find((d) => d.id === disc.id);
		expect(updated?.status).toBe('staged');
	});

	it('promotes to complete when the same title appears in the jellyfin tree', async () => {
		const stagedPath = join(stagingRoot, 'Inception');
		const [disc] = testDb
			.insert(discs)
			.values({
				title: 'Inception',
				mediaType: 'movie',
				watchmodeId: 3,
				status: 'staged',
				stagedPath
			})
			.returning()
			.all();

		startWatcher();
		await new Promise((resolve) => setTimeout(resolve, 300));

		mkdirSync(join(jellyfinRoot, 'movies', 'Inception'));

		await waitFor(() => {
			const row = testDb
				.select()
				.from(discs)
				.all()
				.find((d) => d.id === disc.id);
			return row?.status === 'complete';
		});

		const updated = testDb
			.select()
			.from(discs)
			.all()
			.find((d) => d.id === disc.id);
		expect(updated?.completePath).toBe(join(jellyfinRoot, 'movies', 'Inception'));
	});

	it('is safe to call startWatcher twice (singleton)', () => {
		startWatcher();
		expect(() => startWatcher()).not.toThrow();
	});

	it('warns when JELLYFIN_PATH has no movies/tv subfolder (misconfigured path)', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockEnv.JELLYFIN_PATH = join(jellyfinRoot, 'nonexistent-nested-root');

		startWatcher();

		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('JELLYFIN_PATH'));
		warnSpy.mockRestore();
	});

	it('warns when STAGING_PATH does not exist or is empty', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockEnv.STAGING_PATH = join(stagingRoot, 'nonexistent-root');

		startWatcher();

		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('STAGING_PATH'));
		warnSpy.mockRestore();
	});

	it('does not warn when the configured roots are structured correctly', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		startWatcher();

		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('detects a TV season folder in jellyfin and links only the matching season', async () => {
		mkdirSync(join(jellyfinRoot, 'tv'), { recursive: true });
		const [season1] = testDb
			.insert(discs)
			.values({ title: 'Breaking Bad', mediaType: 'tv', season: 1, watchmodeId: 10 })
			.returning()
			.all();
		const [season2] = testDb
			.insert(discs)
			.values({ title: 'Breaking Bad', mediaType: 'tv', season: 2, watchmodeId: 10 })
			.returning()
			.all();

		startWatcher();
		await new Promise((resolve) => setTimeout(resolve, 300));

		mkdirSync(join(jellyfinRoot, 'tv', 'Breaking Bad', 'Season 2'), { recursive: true });

		await waitFor(() => {
			const row = testDb
				.select()
				.from(discs)
				.all()
				.find((d) => d.id === season2.id);
			return row?.status === 'complete';
		});

		const rows = testDb.select().from(discs).all();
		expect(rows.find((d) => d.id === season2.id)?.status).toBe('complete');
		expect(rows.find((d) => d.id === season1.id)?.status).toBe('not_started');
	});

	it('does not auto-link a flat staging folder when multiple discs share the same title', async () => {
		const [season1] = testDb
			.insert(discs)
			.values({ title: 'The Vicar of Dibley', mediaType: 'tv', season: 1, watchmodeId: 20 })
			.returning()
			.all();
		testDb
			.insert(discs)
			.values({ title: 'The Vicar of Dibley', mediaType: 'tv', season: 2, watchmodeId: 20 })
			.run();

		mkdirSync(join(stagingRoot, 'THE_VICAR_OF_DIBLEY_XMAS_SPECIAL'));

		startWatcher();

		await waitFor(() => testDb.select().from(unmatchedFiles).all().length > 0);

		const updated = testDb
			.select()
			.from(discs)
			.all()
			.find((d) => d.id === season1.id);
		expect(updated?.status).toBe('not_started');
	});
});
