import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '$lib/server/db/client';
import { discs } from '$lib/server/db/schema';

const testDb = createDb(':memory:');
migrate(testDb, { migrationsFolder: 'drizzle' });

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { GET } = await import('./+server');

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

describe('GET /api/widget/status', () => {
	it('returns null for both when nothing is armed or ripping', async () => {
		const response = await GET({} as Parameters<typeof GET>[0]);
		const data = await response.json();

		expect(data.armed).toBeNull();
		expect(data.ripping).toBeNull();
	});

	it('reports the armed disc', async () => {
		const disc = makeDisc({ status: 'not_started', armedAt: Date.now() });

		const response = await GET({} as Parameters<typeof GET>[0]);
		const data = await response.json();

		expect(data.armed).toMatchObject({ id: disc.id, title: 'Inception' });
		expect(data.ripping).toBeNull();
	});

	it('reports the ripping disc with progress', async () => {
		const disc = makeDisc({
			status: 'ripping',
			ripTitlesCompleted: 2,
			ripTitlesTotal: 5
		});

		const response = await GET({} as Parameters<typeof GET>[0]);
		const data = await response.json();

		expect(data.ripping).toMatchObject({
			id: disc.id,
			title: 'Inception',
			ripTitlesCompleted: 2,
			ripTitlesTotal: 5
		});
		expect(data.armed).toBeNull();
	});
});
