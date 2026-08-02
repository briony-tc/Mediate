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

function makeDisc() {
	const [disc] = testDb
		.insert(discs)
		.values({ title: 'Inception', mediaType: 'movie', watchmodeId: 1 })
		.returning()
		.all();
	return disc;
}

afterEach(() => {
	testDb.delete(unmatchedFiles).run();
	testDb.delete(discs).run();
});

describe('POST /api/remove', () => {
	it('returns 400 when discId is missing', async () => {
		const response = await POST(makeRequest({}));
		expect(response.status).toBe(400);
	});

	it('returns 404 for an unknown id', async () => {
		const response = await POST(makeRequest({ discId: 999 }));
		expect(response.status).toBe(404);
	});

	it('deletes the disc', async () => {
		const disc = makeDisc();

		const response = await POST(makeRequest({ discId: disc.id }));
		const data = await response.json();

		expect(data.disc.id).toBe(disc.id);
		expect(testDb.select().from(discs).all()).toHaveLength(0);
	});

	it('deletes a linked unmatchedFiles row referencing the removed disc, so the file can be re-matched', async () => {
		const disc = makeDisc();
		testDb
			.insert(unmatchedFiles)
			.values({
				path: '/staging/Inception',
				tree: 'staging',
				bestGuessDiscId: disc.id,
				resolution: 'linked'
			})
			.run();

		await POST(makeRequest({ discId: disc.id }));

		expect(testDb.select().from(unmatchedFiles).all()).toHaveLength(0);
	});

	it('leaves an unresolved unmatchedFiles row referencing the removed disc alone (it gets retried anyway)', async () => {
		const disc = makeDisc();
		testDb
			.insert(unmatchedFiles)
			.values({
				path: '/staging/Inception',
				tree: 'staging',
				bestGuessDiscId: disc.id,
				resolution: 'unresolved'
			})
			.run();

		await POST(makeRequest({ discId: disc.id }));

		expect(testDb.select().from(unmatchedFiles).all()).toHaveLength(1);
	});
});
