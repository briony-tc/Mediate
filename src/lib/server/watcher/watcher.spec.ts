import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
	mkdirSync(join(stagingRoot, 'movies'), { recursive: true });
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
	it('detects an existing folder at startup and auto-links a matching disc', async () => {
		const [disc] = testDb
			.insert(discs)
			.values({ title: 'Inception', mediaType: 'movie', watchmodeId: 1 })
			.returning()
			.all();
		mkdirSync(join(stagingRoot, 'movies', 'Inception'));

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
		expect(updated?.stagedPath).toBe(join(stagingRoot, 'movies', 'Inception'));
	});

	it('detects a folder added live after startup', async () => {
		const [disc] = testDb
			.insert(discs)
			.values({ title: 'The Matrix', mediaType: 'movie', watchmodeId: 2 })
			.returning()
			.all();

		startWatcher();
		await new Promise((resolve) => setTimeout(resolve, 300));

		mkdirSync(join(stagingRoot, 'movies', 'The Matrix'));

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
		const stagedPath = join(stagingRoot, 'movies', 'Inception');
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

	it('detects a TV season folder and links only the matching season', async () => {
		mkdirSync(join(stagingRoot, 'tv'), { recursive: true });
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

		mkdirSync(join(stagingRoot, 'tv', 'Breaking Bad', 'Season 2'), { recursive: true });

		await waitFor(() => {
			const row = testDb
				.select()
				.from(discs)
				.all()
				.find((d) => d.id === season2.id);
			return row?.status === 'staged';
		});

		const rows = testDb.select().from(discs).all();
		expect(rows.find((d) => d.id === season2.id)?.status).toBe('staged');
		expect(rows.find((d) => d.id === season1.id)?.status).toBe('not_started');
	});
});
