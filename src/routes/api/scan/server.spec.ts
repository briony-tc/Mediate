import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '$lib/server/db/client';
import { scanEvents } from '$lib/server/db/schema';

const testDb = createDb(':memory:');
migrate(testDb, { migrationsFolder: 'drizzle' });

vi.mock('$lib/server/db', () => ({ db: testDb }));

const lookupUpc = vi.fn();
vi.mock('$lib/server/clients/upc', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/server/clients/upc')>('$lib/server/clients/upc');
	return {
		...actual,
		lookupUpc: (...args: unknown[]) => lookupUpc(...args)
	};
});

const { UpcLookupUnavailableError } = await import('$lib/server/clients/upc');

const searchTitlesWithFallback = vi.fn();
vi.mock('$lib/server/clients/watchmode', () => ({
	searchTitlesWithFallback: (...args: unknown[]) => searchTitlesWithFallback(...args)
}));

const { POST } = await import('./+server');

function makeRequest(body: unknown) {
	return { request: { json: async () => body } } as Parameters<typeof POST>[0];
}

afterEach(() => {
	vi.clearAllMocks();
	testDb.delete(scanEvents).run();
});

describe('POST /api/scan', () => {
	it('returns 400 when barcode is missing', async () => {
		const response = await POST(makeRequest({}));
		expect(response.status).toBe(400);
	});

	it('logs no_upc_match and returns empty results when the barcode has no UPC match', async () => {
		lookupUpc.mockResolvedValue(null);

		const response = await POST(makeRequest({ barcode: '000' }));
		const data = await response.json();

		expect(data).toEqual({ upcTitle: null, results: [] });
		const events = testDb.select().from(scanEvents).all();
		expect(events).toHaveLength(1);
		expect(events[0].outcome).toBe('no_upc_match');
	});

	it('logs ambiguous and returns candidates when watchmode returns multiple matches', async () => {
		lookupUpc.mockResolvedValue({ title: 'Inception Widescreen DVD' });
		searchTitlesWithFallback.mockResolvedValue([
			{ id: 1, name: 'Inception', type: 'movie' },
			{ id: 2, name: 'Inception 2', type: 'movie' }
		]);

		const response = await POST(makeRequest({ barcode: '883929127538' }));
		const data = await response.json();

		expect(data.upcTitle).toBe('Inception Widescreen DVD');
		expect(data.results).toHaveLength(2);
		const events = testDb.select().from(scanEvents).all();
		expect(events[0].outcome).toBe('ambiguous');
	});

	it('does not log a scan event when there is exactly one clean match', async () => {
		lookupUpc.mockResolvedValue({ title: 'Inception' });
		searchTitlesWithFallback.mockResolvedValue([{ id: 1, name: 'Inception', type: 'movie' }]);

		await POST(makeRequest({ barcode: '883929127538' }));

		expect(testDb.select().from(scanEvents).all()).toHaveLength(0);
	});

	it('returns upcUnavailable instead of crashing when UPCitemdb is rate-limited', async () => {
		lookupUpc.mockRejectedValue(new UpcLookupUnavailableError('rate limited'));

		const response = await POST(makeRequest({ barcode: '883929127538' }));
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data).toEqual({ upcTitle: null, results: [], upcUnavailable: true });
	});

	it('re-throws other lookupUpc errors instead of swallowing them', async () => {
		lookupUpc.mockRejectedValue(new Error('network error'));

		await expect(POST(makeRequest({ barcode: '883929127538' }))).rejects.toThrow('network error');
	});
});
