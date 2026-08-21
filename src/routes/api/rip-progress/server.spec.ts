import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '$lib/server/db/client';
import { discs } from '$lib/server/db/schema';

const testDb = createDb(':memory:');
migrate(testDb, { migrationsFolder: 'drizzle' });
vi.mock('$lib/server/db', () => ({ db: testDb }));

const SECRET = 'test-webhook-secret';
const mockEnv: Record<string, string | undefined> = { RIP_WEBHOOK_SECRET: SECRET };
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const { POST } = await import('./+server');

let stagingRoot: string;

function makeRequest(body: unknown, authorization = `Bearer ${SECRET}`) {
	return {
		request: {
			json: async () => body,
			headers: {
				get: (name: string) => (name.toLowerCase() === 'authorization' ? authorization : null)
			}
		}
	} as Parameters<typeof POST>[0];
}

function seedDisc(overrides: Partial<typeof discs.$inferInsert> = {}) {
	const [disc] = testDb
		.insert(discs)
		.values({ title: 'Inception', mediaType: 'movie', watchmodeId: 1, ...overrides })
		.returning()
		.all();
	return disc;
}

beforeEach(() => {
	const root = mkdtempSync(join(tmpdir(), 'mls-rip-progress-'));
	stagingRoot = join(root, 'staging');
	mkdirSync(stagingRoot, { recursive: true });
	mockEnv.STAGING_PATH = stagingRoot;
});

afterEach(() => {
	rmSync(join(stagingRoot, '..'), { recursive: true, force: true });
	testDb.delete(discs).run();
});

describe('POST /api/rip-progress', () => {
	it('returns 401 when the bearer secret is wrong', async () => {
		const response = await POST(
			makeRequest({ stagingFolderName: 'x', titlesCompleted: 0, titlesTotal: 2 }, 'Bearer wrong')
		);
		expect(response.status).toBe(401);
	});

	it('returns 400 when stagingFolderName is missing', async () => {
		const response = await POST(makeRequest({ titlesCompleted: 0, titlesTotal: 2 }));
		expect(response.status).toBe(400);
	});

	it('returns 400 when titlesTotal is missing, not an integer, or less than 1', async () => {
		expect((await POST(makeRequest({ stagingFolderName: 'x', titlesCompleted: 0 }))).status).toBe(
			400
		);
		expect(
			(await POST(makeRequest({ stagingFolderName: 'x', titlesCompleted: 0, titlesTotal: 1.5 })))
				.status
		).toBe(400);
		expect(
			(await POST(makeRequest({ stagingFolderName: 'x', titlesCompleted: 0, titlesTotal: 0 })))
				.status
		).toBe(400);
	});

	it('returns 400 when titlesCompleted is missing, negative, or greater than titlesTotal', async () => {
		expect((await POST(makeRequest({ stagingFolderName: 'x', titlesTotal: 3 }))).status).toBe(400);
		expect(
			(await POST(makeRequest({ stagingFolderName: 'x', titlesCompleted: -1, titlesTotal: 3 })))
				.status
		).toBe(400);
		expect(
			(await POST(makeRequest({ stagingFolderName: 'x', titlesCompleted: 4, titlesTotal: 3 })))
				.status
		).toBe(400);
	});

	it("updates the ripping disc's title progress", async () => {
		const disc = seedDisc({ status: 'ripping', stagedPath: join(stagingRoot, 'Inception') });

		const response = await POST(
			makeRequest({ stagingFolderName: 'Inception', titlesCompleted: 1, titlesTotal: 3 })
		);
		const data = await response.json();

		expect(data.outcome).toBe('updated');
		const updated = testDb
			.select()
			.from(discs)
			.all()
			.find((d) => d.id === disc.id);
		expect(updated?.ripTitlesCompleted).toBe(1);
		expect(updated?.ripTitlesTotal).toBe(3);
	});

	it('is a no-op for a staging folder with no matching disc', async () => {
		const response = await POST(
			makeRequest({ stagingFolderName: 'Unknown', titlesCompleted: 0, titlesTotal: 1 })
		);
		const data = await response.json();
		expect(data.outcome).toBe('ignored');
	});

	it('is a no-op for a disc that is no longer ripping (e.g. rip-complete already fired)', async () => {
		const disc = seedDisc({ status: 'complete', stagedPath: join(stagingRoot, 'Inception') });

		const response = await POST(
			makeRequest({ stagingFolderName: 'Inception', titlesCompleted: 3, titlesTotal: 3 })
		);
		const data = await response.json();

		expect(data.outcome).toBe('ignored');
		const updated = testDb
			.select()
			.from(discs)
			.all()
			.find((d) => d.id === disc.id);
		expect(updated?.ripTitlesCompleted).toBeNull();
	});

	it('updates the actively-ripping disc, not an old complete disc that reused the same staging path (same MakeMKV volume label)', async () => {
		const oldDisc = seedDisc({
			title: 'Captain America: The Winter Soldier',
			status: 'complete',
			stagedPath: join(stagingRoot, 'CAPTAIN_AMERICA')
		});
		const activeDisc = seedDisc({
			title: 'Captain America: The First Avenger',
			status: 'ripping',
			stagedPath: join(stagingRoot, 'CAPTAIN_AMERICA')
		});

		const response = await POST(
			makeRequest({ stagingFolderName: 'CAPTAIN_AMERICA', titlesCompleted: 2, titlesTotal: 5 })
		);
		const data = await response.json();

		expect(data.outcome).toBe('updated');
		const rows = testDb.select().from(discs).all();
		expect(rows.find((d) => d.id === activeDisc.id)?.ripTitlesCompleted).toBe(2);
		expect(rows.find((d) => d.id === oldDisc.id)?.ripTitlesCompleted).toBeNull();
	});
});
