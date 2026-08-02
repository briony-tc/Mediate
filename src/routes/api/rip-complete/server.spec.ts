import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '$lib/server/db/client';
import { discs, unmatchedFiles } from '$lib/server/db/schema';

const testDb = createDb(':memory:');
migrate(testDb, { migrationsFolder: 'drizzle' });
vi.mock('$lib/server/db', () => ({ db: testDb }));

const SECRET = 'test-webhook-secret';
const mockEnv: Record<string, string | undefined> = {
	RIP_WEBHOOK_SECRET: SECRET,
	VAPID_PUBLIC_KEY:
		'BEbzz8nkNdDp05WonfkESb1o2GAgwYvAey-7M4RLS1__EkLNufWeXLrtHn59PkXg85ShhcJSubfq8rgnohP9nnE',
	VAPID_PRIVATE_KEY: 'THcVXAh4AO0bbVdB-RibLpfrmxWbBUtSOY0gfjjYBlA',
	VAPID_SUBJECT: 'mailto:test@example.com'
};
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const { POST } = await import('./+server');

let stagingRoot: string;
let jellyfinRoot: string;

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

beforeEach(() => {
	const root = mkdtempSync(join(tmpdir(), 'mls-rip-complete-'));
	stagingRoot = join(root, 'staging');
	jellyfinRoot = join(root, 'jellyfin');
	mkdirSync(stagingRoot, { recursive: true });
	mkdirSync(jellyfinRoot, { recursive: true });
	mockEnv.STAGING_PATH = stagingRoot;
	mockEnv.JELLYFIN_PATH = jellyfinRoot;
});

afterEach(() => {
	rmSync(join(stagingRoot, '..'), { recursive: true, force: true });
	testDb.delete(unmatchedFiles).run();
	testDb.delete(discs).run();
});

describe('POST /api/rip-complete', () => {
	it('returns 401 when the bearer secret is wrong', async () => {
		const response = await POST(makeRequest({ stagingFolderName: 'x' }, 'Bearer wrong'));
		expect(response.status).toBe(401);
	});

	it('returns 400 when stagingFolderName is missing', async () => {
		const response = await POST(makeRequest({}));
		expect(response.status).toBe(400);
	});

	it('promotes a confidently-matched rip straight into the jellyfin tree', async () => {
		const [disc] = testDb
			.insert(discs)
			.values({ title: 'Inception', mediaType: 'movie', watchmodeId: 1 })
			.returning()
			.all();
		mkdirSync(join(stagingRoot, 'Inception'));
		writeFileSync(join(stagingRoot, 'Inception', 'title_t00.mkv'), 'x');

		const response = await POST(makeRequest({ stagingFolderName: 'Inception' }));
		const data = await response.json();

		expect(data.outcome).toBe('promoted');
		expect(readdirSync(join(jellyfinRoot, 'movies', 'Inception'))).toEqual(['Inception.mkv']);

		const updated = testDb
			.select()
			.from(discs)
			.all()
			.find((d) => d.id === disc.id);
		expect(updated?.status).toBe('complete');
	});

	it('leaves an ambiguous/unmatched rip for manual review instead of guessing', async () => {
		const response = await POST(makeRequest({ stagingFolderName: 'Some Unrecognized Disc' }));
		const data = await response.json();

		expect(data.outcome).toBe('needs_review');
		expect(testDb.select().from(unmatchedFiles).all()).toHaveLength(1);
	});

	it('flags a confidently-matched rip that fails to auto-file as needs_attention', async () => {
		const [disc] = testDb
			.insert(discs)
			.values({ title: 'Breaking Bad', mediaType: 'tv', season: null, watchmodeId: 1 })
			.returning()
			.all();
		mkdirSync(join(stagingRoot, 'Breaking Bad'));
		writeFileSync(join(stagingRoot, 'Breaking Bad', 'title_t00.mkv'), 'x');

		const response = await POST(makeRequest({ stagingFolderName: 'Breaking Bad' }));
		const data = await response.json();

		expect(data.outcome).toBe('needs_attention');
		const updated = testDb
			.select()
			.from(discs)
			.all()
			.find((d) => d.id === disc.id);
		expect(updated?.status).toBe('staged');
	});
});
