import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '$lib/server/db/client';
import { discs } from '$lib/server/db/schema';

const testDb = createDb(':memory:');
migrate(testDb, { migrationsFolder: 'drizzle' });
vi.mock('$lib/server/db', () => ({ db: testDb }));

const SECRET = 'test-webhook-secret';
const mockEnv: Record<string, string | undefined> = { RIP_WEBHOOK_SECRET: SECRET };
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const { GET } = await import('./+server');

function makeRequest(authorization = `Bearer ${SECRET}`) {
	return {
		request: {
			headers: {
				get: (name: string) => (name.toLowerCase() === 'authorization' ? authorization : null)
			}
		}
	} as Parameters<typeof GET>[0];
}

function seedDisc(overrides: Partial<typeof discs.$inferInsert> = {}) {
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

describe('GET /api/armed', () => {
	it('returns 401 when the bearer secret is wrong', async () => {
		const response = await GET(makeRequest('Bearer wrong'));
		expect(response.status).toBe(401);
	});

	it('returns a null mediaType when nothing is armed', async () => {
		const response = await GET(makeRequest());
		const data = await response.json();
		expect(data.mediaType).toBeNull();
	});

	it("returns the armed disc's mediaType (movie)", async () => {
		seedDisc({ mediaType: 'movie', status: 'not_started', armedAt: Date.now() });

		const response = await GET(makeRequest());
		const data = await response.json();

		expect(data.mediaType).toBe('movie');
	});

	it("returns the armed disc's mediaType (tv)", async () => {
		seedDisc({ mediaType: 'tv', season: 1, status: 'not_started', armedAt: Date.now() });

		const response = await GET(makeRequest());
		const data = await response.json();

		expect(data.mediaType).toBe('tv');
	});

	it('ignores an armed disc that is no longer not_started', async () => {
		seedDisc({ mediaType: 'movie', status: 'ripping', armedAt: Date.now() });

		const response = await GET(makeRequest());
		const data = await response.json();

		expect(data.mediaType).toBeNull();
	});
});
