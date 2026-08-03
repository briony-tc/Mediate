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

describe('POST /api/arm', () => {
	it('returns 400 when discId is missing', async () => {
		const response = await POST(makeRequest({}));
		expect(response.status).toBe(400);
	});

	it('returns 404 for an unknown id', async () => {
		const response = await POST(makeRequest({ discId: 999 }));
		expect(response.status).toBe(404);
	});

	it('returns 409 when the disc is not not_started', async () => {
		const disc = makeDisc({ status: 'ripping' });
		const response = await POST(makeRequest({ discId: disc.id }));
		expect(response.status).toBe(409);
	});

	it('arms a not_started disc', async () => {
		const disc = makeDisc({ status: 'not_started' });

		const response = await POST(makeRequest({ discId: disc.id }));
		const data = await response.json();

		expect(data.disc.armedAt).not.toBeNull();
		expect(testDb.select().from(discs).all()[0].armedAt).not.toBeNull();
	});

	it('swaps the armed disc, unarming whichever was armed before', async () => {
		const first = makeDisc({ status: 'not_started', armedAt: Date.now() });
		const second = makeDisc({ status: 'not_started' });

		await POST(makeRequest({ discId: second.id }));

		const rows = testDb.select().from(discs).all();
		expect(rows.find((d) => d.id === first.id)?.armedAt).toBeNull();
		expect(rows.find((d) => d.id === second.id)?.armedAt).not.toBeNull();
	});
});
