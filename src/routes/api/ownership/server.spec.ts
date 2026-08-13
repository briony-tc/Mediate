import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '$lib/server/db/client';
import { discs } from '$lib/server/db/schema';

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

afterEach(() => {
	testDb.delete(discs).run();
});

describe('POST /api/ownership', () => {
	it('returns 400 when discId is missing', async () => {
		const response = await POST(makeRequest({ ownership: 'owned' }));
		expect(response.status).toBe(400);
	});

	it('returns 400 for an unrecognized ownership value', async () => {
		const disc = makeDisc();
		const response = await POST(makeRequest({ discId: disc.id, ownership: 'bogus' }));
		expect(response.status).toBe(400);
	});

	it('returns 404 for an unknown discId', async () => {
		const response = await POST(makeRequest({ discId: 999, ownership: 'wanted' }));
		expect(response.status).toBe(404);
	});

	it('updates ownership on an existing disc', async () => {
		const disc = makeDisc({ ownership: 'owned' });

		const response = await POST(makeRequest({ discId: disc.id, ownership: 'digital_only' }));
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.disc.ownership).toBe('digital_only');
		expect(testDb.select().from(discs).all()[0].ownership).toBe('digital_only');
	});
});
