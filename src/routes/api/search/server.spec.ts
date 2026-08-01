import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '$lib/server/db/client';
import { scanEvents } from '$lib/server/db/schema';

const testDb = createDb(':memory:');
migrate(testDb, { migrationsFolder: 'drizzle' });

vi.mock('$lib/server/db', () => ({ db: testDb }));

const searchTitles = vi.fn();
vi.mock('$lib/server/clients/watchmode', () => ({
	searchTitles: (...args: unknown[]) => searchTitles(...args)
}));

const { POST } = await import('./+server');

function makeRequest(body: unknown) {
	return { request: { json: async () => body } } as Parameters<typeof POST>[0];
}

afterEach(() => {
	vi.clearAllMocks();
	testDb.delete(scanEvents).run();
});

describe('POST /api/search', () => {
	it('returns 400 when query is missing', async () => {
		const response = await POST(makeRequest({}));
		expect(response.status).toBe(400);
	});

	it('returns watchmode results and logs a manual_search event', async () => {
		searchTitles.mockResolvedValue([{ id: 1, name: 'Inception', type: 'movie' }]);

		const response = await POST(makeRequest({ query: 'Inception' }));
		const data = await response.json();

		expect(data.results).toHaveLength(1);
		const events = testDb.select().from(scanEvents).all();
		expect(events).toHaveLength(1);
		expect(events[0].outcome).toBe('manual_search');
		expect(events[0].upcTitle).toBe('Inception');
	});
});
