import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '$lib/server/db/client';
import { unmatchedFiles } from '$lib/server/db/schema';

const testDb = createDb(':memory:');
migrate(testDb, { migrationsFolder: 'drizzle' });

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { POST } = await import('./+server');

function makeRequest(body: unknown) {
	return { request: { json: async () => body } } as Parameters<typeof POST>[0];
}

afterEach(() => {
	testDb.delete(unmatchedFiles).run();
});

describe('POST /api/unmatched-remove', () => {
	it('returns 400 when unmatchedFileId is missing', async () => {
		const response = await POST(makeRequest({}));
		expect(response.status).toBe(400);
	});

	it('returns 404 for an unknown id', async () => {
		const response = await POST(makeRequest({ unmatchedFileId: 999 }));
		expect(response.status).toBe(404);
	});

	it('permanently deletes the unmatched file row', async () => {
		const [row] = testDb
			.insert(unmatchedFiles)
			.values({ path: '/jellyfin/movies/Some Movie', tree: 'jellyfin', resolution: 'ignored' })
			.returning()
			.all();

		const response = await POST(makeRequest({ unmatchedFileId: row.id }));
		const data = await response.json();

		expect(data.unmatchedFile.id).toBe(row.id);
		expect(testDb.select().from(unmatchedFiles).all()).toHaveLength(0);
	});
});
