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

afterEach(() => {
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

	it('links a staging-tree unmatched file to a disc, promoting it to staged', async () => {
		const [disc] = testDb
			.insert(discs)
			.values({ title: 'Inception', mediaType: 'movie', watchmodeId: 1 })
			.returning()
			.all();
		const [unmatched] = testDb
			.insert(unmatchedFiles)
			.values({ path: '/staging/movies/Weird Name', tree: 'staging' })
			.returning()
			.all();

		const response = await POST(makeRequest({ unmatchedFileId: unmatched.id, discId: disc.id }));
		const data = await response.json();

		expect(data.disc).toMatchObject({
			id: disc.id,
			status: 'staged',
			stagedPath: '/staging/movies/Weird Name'
		});

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
