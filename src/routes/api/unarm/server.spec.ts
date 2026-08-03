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

describe('POST /api/unarm', () => {
	it('returns 400 when discId is missing', async () => {
		const response = await POST(makeRequest({}));
		expect(response.status).toBe(400);
	});

	it('clears armedAt for the given disc', async () => {
		const disc = makeDisc({ status: 'not_started', armedAt: Date.now() });

		const response = await POST(makeRequest({ discId: disc.id }));

		expect(response.status).toBe(200);
		expect(testDb.select().from(discs).all()[0].armedAt).toBeNull();
	});

	it('is a no-op for a disc that was not armed', async () => {
		const disc = makeDisc({ status: 'not_started' });

		const response = await POST(makeRequest({ discId: disc.id }));

		expect(response.status).toBe(200);
		expect(testDb.select().from(discs).all()[0].armedAt).toBeNull();
	});

	it('is a no-op for an unknown discId (no error)', async () => {
		const response = await POST(makeRequest({ discId: 999 }));
		expect(response.status).toBe(200);
	});
});
