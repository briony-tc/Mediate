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
			makeRequest({ stagingFolderName: 'x', percent: 50 }, 'Bearer wrong')
		);
		expect(response.status).toBe(401);
	});

	it('returns 400 when stagingFolderName is missing', async () => {
		const response = await POST(makeRequest({ percent: 50 }));
		expect(response.status).toBe(400);
	});

	it('returns 400 when percent is missing or out of range', async () => {
		expect((await POST(makeRequest({ stagingFolderName: 'x' }))).status).toBe(400);
		expect((await POST(makeRequest({ stagingFolderName: 'x', percent: -1 }))).status).toBe(400);
		expect((await POST(makeRequest({ stagingFolderName: 'x', percent: 101 }))).status).toBe(400);
	});

	it("updates the ripping disc's progress percent", async () => {
		const disc = seedDisc({ status: 'ripping', stagedPath: join(stagingRoot, 'Inception') });

		const response = await POST(makeRequest({ stagingFolderName: 'Inception', percent: 42 }));
		const data = await response.json();

		expect(data.outcome).toBe('updated');
		const updated = testDb
			.select()
			.from(discs)
			.all()
			.find((d) => d.id === disc.id);
		expect(updated?.ripProgressPercent).toBe(42);
	});

	it('is a no-op for a staging folder with no matching disc', async () => {
		const response = await POST(makeRequest({ stagingFolderName: 'Unknown', percent: 10 }));
		const data = await response.json();
		expect(data.outcome).toBe('ignored');
	});

	it('is a no-op for a disc that is no longer ripping (e.g. rip-complete already fired)', async () => {
		const disc = seedDisc({ status: 'complete', stagedPath: join(stagingRoot, 'Inception') });

		const response = await POST(makeRequest({ stagingFolderName: 'Inception', percent: 99 }));
		const data = await response.json();

		expect(data.outcome).toBe('ignored');
		const updated = testDb
			.select()
			.from(discs)
			.all()
			.find((d) => d.id === disc.id);
		expect(updated?.ripProgressPercent).toBeNull();
	});
});
