import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '$lib/server/db/client';
import { discs, unmatchedFiles } from '$lib/server/db/schema';

const testDb = createDb(':memory:');
migrate(testDb, { migrationsFolder: 'drizzle' });

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { POST } = await import('./+server');

function makeRequest(body: unknown) {
	return { request: { json: async () => body } } as Parameters<typeof POST>[0];
}

function makeDisc(overrides: Partial<typeof discs.$inferInsert> = {}) {
	const [disc] = testDb
		.insert(discs)
		.values({ title: 'Inception', mediaType: 'movie', watchmodeId: 1, ...overrides })
		.returning()
		.all();
	return disc;
}

let tmpRoot: string | undefined;

afterEach(() => {
	testDb.delete(unmatchedFiles).run();
	testDb.delete(discs).run();
	if (tmpRoot) {
		rmSync(tmpRoot, { recursive: true, force: true });
		tmpRoot = undefined;
	}
});

describe('POST /api/unlink', () => {
	it('returns 400 when discId is missing', async () => {
		const response = await POST(makeRequest({}));
		expect(response.status).toBe(400);
	});

	it('returns 404 for an unknown discId', async () => {
		const response = await POST(makeRequest({ discId: 999 }));
		expect(response.status).toBe(404);
	});

	it('returns 409 for a not_started disc', async () => {
		const disc = makeDisc({ status: 'not_started' });
		const response = await POST(makeRequest({ discId: disc.id }));
		expect(response.status).toBe(409);
	});

	it('resets a ripping disc with no stagedPath back to not_started', async () => {
		const disc = makeDisc({ status: 'ripping' });
		const response = await POST(makeRequest({ discId: disc.id }));
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.disc.status).toBe('not_started');
	});

	it('resets a ripping disc back to not_started when its staging folder no longer exists on disk', async () => {
		const disc = makeDisc({
			status: 'ripping',
			stagedPath: join(tmpdir(), 'mls-unlink-does-not-exist-' + Date.now())
		});
		const response = await POST(makeRequest({ discId: disc.id }));
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.disc.status).toBe('not_started');
	});

	it('resets a ripping disc back to not_started when its staging folder has not been touched recently', async () => {
		tmpRoot = mkdtempSync(join(tmpdir(), 'mls-unlink-'));
		const stagedPath = join(tmpRoot, 'CAPTAIN_AMERICA');
		mkdirSync(stagedPath);
		const filePath = join(stagedPath, 'title_t00.mkv');
		writeFileSync(filePath, 'x');
		const old = new Date(Date.now() - 20 * 60 * 1000);
		utimesSync(filePath, old, old);
		utimesSync(stagedPath, old, old);

		const disc = makeDisc({ status: 'ripping', stagedPath });
		const response = await POST(makeRequest({ discId: disc.id }));
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.disc.status).toBe('not_started');
		expect(data.disc.stagedPath).toBeNull();
	});

	it("returns 409 and does not reset when the ripping disc's staging folder was modified within the safety window", async () => {
		tmpRoot = mkdtempSync(join(tmpdir(), 'mls-unlink-'));
		const stagedPath = join(tmpRoot, 'CAPTAIN_AMERICA');
		mkdirSync(stagedPath);
		writeFileSync(join(stagedPath, 'title_t00.mkv'), 'x'); // fresh mtime = now

		const disc = makeDisc({ status: 'ripping', stagedPath });
		const response = await POST(makeRequest({ discId: disc.id }));

		expect(response.status).toBe(409);
		const row = testDb
			.select()
			.from(discs)
			.all()
			.find((d) => d.id === disc.id);
		expect(row?.status).toBe('ripping');
	});

	it('resets a complete disc back to not_started and reverts its linked unmatched file', async () => {
		const disc = makeDisc({
			status: 'complete',
			completePath: '/jellyfin/movies/Extras Folder By Mistake',
			completedAt: Date.now()
		});
		testDb
			.insert(unmatchedFiles)
			.values({
				path: '/jellyfin/movies/Extras Folder By Mistake',
				tree: 'jellyfin',
				resolution: 'linked'
			})
			.run();

		const response = await POST(makeRequest({ discId: disc.id }));
		const data = await response.json();

		expect(data.disc).toMatchObject({
			status: 'not_started',
			completePath: null,
			completedAt: null
		});

		const updatedUnmatched = testDb.select().from(unmatchedFiles).all()[0];
		expect(updatedUnmatched.resolution).toBe('unresolved');
	});

	it('resets a staged disc back to not_started and reverts its linked unmatched file', async () => {
		const disc = makeDisc({
			status: 'staged',
			stagedPath: '/staging/movies/Wrong Folder',
			stagedAt: Date.now()
		});
		testDb
			.insert(unmatchedFiles)
			.values({ path: '/staging/movies/Wrong Folder', tree: 'staging', resolution: 'linked' })
			.run();

		const response = await POST(makeRequest({ discId: disc.id }));
		const data = await response.json();

		expect(data.disc).toMatchObject({ status: 'not_started', stagedPath: null, stagedAt: null });

		const updatedUnmatched = testDb.select().from(unmatchedFiles).all()[0];
		expect(updatedUnmatched.resolution).toBe('unresolved');
	});

	it('does not touch an unrelated unmatched file at a different path', async () => {
		const disc = makeDisc({ status: 'complete', completePath: '/jellyfin/movies/Right One' });
		testDb
			.insert(unmatchedFiles)
			.values({ path: '/jellyfin/movies/Something Else', tree: 'jellyfin', resolution: 'linked' })
			.run();

		await POST(makeRequest({ discId: disc.id }));

		const updatedUnmatched = testDb.select().from(unmatchedFiles).all()[0];
		expect(updatedUnmatched.resolution).toBe('linked');
	});
});
