import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '$lib/server/db/client';
import { discs, unmatchedFiles } from '$lib/server/db/schema';

const testDb = createDb(':memory:');
migrate(testDb, { migrationsFolder: 'drizzle' });

vi.mock('$lib/server/db', () => ({ db: testDb }));

const mockEnv: Record<string, string | undefined> = { STAGING_PATH: '/staging' };
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

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
	testDb.delete(unmatchedFiles).run();
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

	it('returns 409 when the disc is not owned (wanted/digital_only have no physical copy)', async () => {
		const disc = makeDisc({ status: 'not_started', ownership: 'wanted' });
		const response = await POST(makeRequest({ discId: disc.id }));
		expect(response.status).toBe(409);
		expect(testDb.select().from(discs).all()[0].armedAt).toBeNull();
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

	it('immediately links a staging folder that was already sitting unresolved before this disc was armed', async () => {
		// e.g. a first rip attempt for a disc nobody had added/armed yet - see
		// reconcile.ts's recheckUnresolvedStaging for why arming alone wouldn't
		// otherwise trigger a re-match.
		testDb
			.insert(unmatchedFiles)
			.values({ path: '/staging/CRIMINAL_MINDS_S3_D4', tree: 'staging', resolution: 'unresolved' })
			.run();
		const disc = makeDisc({ status: 'not_started' });

		const response = await POST(makeRequest({ discId: disc.id }));
		const data = await response.json();

		expect(data.disc.status).toBe('ripping');
		expect(data.disc.stagedPath).toBe('/staging/CRIMINAL_MINDS_S3_D4');
		expect(data.disc.armedAt).toBeNull();
		expect(testDb.select().from(unmatchedFiles).all()).toHaveLength(0);
	});
});
