import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '$lib/server/db/client';
import { discs, unmatchedFiles } from '$lib/server/db/schema';

const testDb = createDb(':memory:');
migrate(testDb, { migrationsFolder: 'drizzle' });

vi.mock('$lib/server/db', () => ({ db: testDb }));

const mockEnv: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const { POST } = await import('./+server');

function makeRequest(body: unknown) {
	return { request: { json: async () => body } } as Parameters<typeof POST>[0];
}

let stagingRoot: string;
let jellyfinRoot: string;

beforeEach(() => {
	const root = mkdtempSync(join(tmpdir(), 'mls-link-'));
	stagingRoot = join(root, 'staging');
	jellyfinRoot = join(root, 'jellyfin');
	mkdirSync(stagingRoot, { recursive: true });
	mkdirSync(jellyfinRoot, { recursive: true });
	mockEnv.JELLYFIN_PATH = jellyfinRoot;
});

afterEach(() => {
	rmSync(join(stagingRoot, '..'), { recursive: true, force: true });
	testDb.delete(unmatchedFiles).run();
	testDb.delete(discs).run();
});

describe('POST /api/link', () => {
	it('returns 400 when ids are missing', async () => {
		const response = await POST(makeRequest({}));
		expect(response.status).toBe(400);
	});

	it('returns 404 when the unmatched file does not exist', async () => {
		const response = await POST(makeRequest({ unmatchedFileId: 1, discId: 1 }));
		expect(response.status).toBe(404);
	});

	it('actually promotes a staging-tree match into Jellyfin, not just marking it staged', async () => {
		const stagingFolder = join(stagingRoot, 'Weird Name');
		mkdirSync(stagingFolder, { recursive: true });
		writeFileSync(join(stagingFolder, 'title_t00.mkv'), 'x');

		const [disc] = testDb
			.insert(discs)
			.values({ title: 'Inception', mediaType: 'movie', watchmodeId: 1 })
			.returning()
			.all();
		const [unmatched] = testDb
			.insert(unmatchedFiles)
			.values({ path: stagingFolder, tree: 'staging' })
			.returning()
			.all();

		const response = await POST(makeRequest({ unmatchedFileId: unmatched.id, discId: disc.id }));
		const data = await response.json();

		expect(data.disc).toMatchObject({ id: disc.id, status: 'complete' });
		expect(readdirSync(join(jellyfinRoot, 'movies', 'Inception'))).toEqual(['Inception.mkv']);

		const updatedUnmatched = testDb.select().from(unmatchedFiles).all()[0];
		expect(updatedUnmatched.resolution).toBe('linked');
	});

	it('falls back to staged (needs attention) when the staging folder has no rippable files', async () => {
		const [disc] = testDb
			.insert(discs)
			.values({ title: 'Inception', mediaType: 'movie', watchmodeId: 1 })
			.returning()
			.all();
		// Folder was recorded as unmatched but doesn't actually exist on disk -
		// promoteToJellyfin should fail gracefully, not throw.
		const [unmatched] = testDb
			.insert(unmatchedFiles)
			.values({ path: join(stagingRoot, 'Does Not Exist'), tree: 'staging' })
			.returning()
			.all();

		const response = await POST(makeRequest({ unmatchedFileId: unmatched.id, discId: disc.id }));
		const data = await response.json();

		expect(data.disc).toMatchObject({ id: disc.id, status: 'staged' });

		const updatedUnmatched = testDb.select().from(unmatchedFiles).all()[0];
		expect(updatedUnmatched.resolution).toBe('linked');
	});

	it('links a jellyfin-tree unmatched file to a disc, promoting it to complete', async () => {
		const [disc] = testDb
			.insert(discs)
			.values({
				title: 'Inception',
				mediaType: 'movie',
				watchmodeId: 1,
				status: 'staged',
				stagedPath: '/staging/movies/Inception'
			})
			.returning()
			.all();
		const [unmatched] = testDb
			.insert(unmatchedFiles)
			.values({ path: '/jellyfin/movies/Weird Name', tree: 'jellyfin' })
			.returning()
			.all();

		const response = await POST(makeRequest({ unmatchedFileId: unmatched.id, discId: disc.id }));
		const data = await response.json();

		expect(data.disc).toMatchObject({
			status: 'complete',
			completePath: '/jellyfin/movies/Weird Name'
		});
	});
});
