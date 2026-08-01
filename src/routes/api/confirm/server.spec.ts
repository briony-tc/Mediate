import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '$lib/server/db/client';
import { discs, scanEvents } from '$lib/server/db/schema';

const testDb = createDb(':memory:');
migrate(testDb, { migrationsFolder: 'drizzle' });

vi.mock('$lib/server/db', () => ({ db: testDb }));

const getTitleDetails = vi.fn();
vi.mock('$lib/server/clients/watchmode', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/clients/watchmode')>(
		'$lib/server/clients/watchmode'
	);
	return {
		...actual,
		getTitleDetails: (...args: unknown[]) => getTitleDetails(...args)
	};
});

const { POST } = await import('./+server');

function makeRequest(body: unknown) {
	return { request: { json: async () => body } } as Parameters<typeof POST>[0];
}

afterEach(() => {
	vi.clearAllMocks();
	testDb.delete(scanEvents).run();
	testDb.delete(discs).run();
});

describe('POST /api/confirm', () => {
	it('returns 400 when watchmodeId is missing', async () => {
		const response = await POST(makeRequest({}));
		expect(response.status).toBe(400);
	});

	it('inserts a disc row and a linked scan event', async () => {
		getTitleDetails.mockResolvedValue({
			id: 1,
			title: 'Inception',
			type: 'movie',
			year: 2010,
			imdbId: 'tt1375666',
			genreNames: ['Action', 'Sci-Fi'],
			posterUrl: 'https://example.com/poster.jpg'
		});

		const response = await POST(
			makeRequest({ watchmodeId: 1, barcode: '883929127538', rawLookupTitle: 'Inception DVD' })
		);
		const data = await response.json();

		expect(response.status).toBe(201);
		expect(data.disc).toMatchObject({
			title: 'Inception',
			mediaType: 'movie',
			status: 'not_started',
			watchmodeId: 1,
			barcodeUpc: '883929127538'
		});

		const events = testDb.select().from(scanEvents).all();
		expect(events).toHaveLength(1);
		expect(events[0].outcome).toBe('linked');
	});

	it('returns 409 without duplicating when the same movie watchmodeId is confirmed twice', async () => {
		getTitleDetails.mockResolvedValue({
			id: 1,
			title: 'Inception',
			type: 'movie',
			genreNames: []
		});

		await POST(makeRequest({ watchmodeId: 1 }));
		const response = await POST(makeRequest({ watchmodeId: 1 }));

		expect(response.status).toBe(409);
		expect(testDb.select().from(discs).all()).toHaveLength(1);
	});

	it('allows tracking multiple seasons of the same TV series independently', async () => {
		getTitleDetails.mockResolvedValue({
			id: 2,
			title: 'Breaking Bad',
			type: 'tv_series',
			genreNames: []
		});

		const season1 = await POST(makeRequest({ watchmodeId: 2, season: 1 }));
		const season2 = await POST(makeRequest({ watchmodeId: 2, season: 2 }));

		expect(season1.status).toBe(201);
		expect(season2.status).toBe(201);

		const rows = testDb.select().from(discs).all();
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.season).sort()).toEqual([1, 2]);
	});

	it('returns 409 without duplicating when the same series/season is confirmed twice', async () => {
		getTitleDetails.mockResolvedValue({
			id: 2,
			title: 'Breaking Bad',
			type: 'tv_series',
			genreNames: []
		});

		await POST(makeRequest({ watchmodeId: 2, season: 1 }));
		const response = await POST(makeRequest({ watchmodeId: 2, season: 1 }));

		expect(response.status).toBe(409);
		expect(testDb.select().from(discs).all()).toHaveLength(1);
	});

	it('ignores a season value sent for a movie', async () => {
		getTitleDetails.mockResolvedValue({
			id: 1,
			title: 'Inception',
			type: 'movie',
			genreNames: []
		});

		const response = await POST(makeRequest({ watchmodeId: 1, season: 3 }));
		const data = await response.json();

		expect(data.disc.season).toBeNull();
	});
});
