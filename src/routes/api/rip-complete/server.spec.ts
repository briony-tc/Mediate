import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '$lib/server/db/client';
import { discs, pipelineEvents, unmatchedFiles } from '$lib/server/db/schema';

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
	testDb.delete(pipelineEvents).run();
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
		expect(data.mediaType).toBe('movie');
		expect(readdirSync(join(jellyfinRoot, 'movies', 'Inception'))).toEqual(['Inception.mkv']);

		const updated = testDb
			.select()
			.from(discs)
			.all()
			.find((d) => d.id === disc.id);
		expect(updated?.status).toBe('complete');
	});

	it('includes mediaType: tv for a promoted TV disc', async () => {
		testDb
			.insert(discs)
			.values({ title: 'Breaking Bad', mediaType: 'tv', season: 1, watchmodeId: 1 })
			.run();
		mkdirSync(join(stagingRoot, 'Breaking Bad'));
		writeFileSync(join(stagingRoot, 'Breaking Bad', 'title_t00.mkv'), 'x');

		const response = await POST(makeRequest({ stagingFolderName: 'Breaking Bad' }));
		const data = await response.json();

		expect(data.outcome).toBe('promoted');
		expect(data.mediaType).toBe('tv');
	});

	it('promotes a disc that was manually linked (status staged) while the rip was still running', async () => {
		// e.g. the user resolved an ambiguous "Needs attention" match via
		// /api/link before makemkvcon finished writing - the disc ends up
		// 'staged' (not 'ripping') by the time this webhook fires, but
		// stagedPath already points at this exact folder, so it's still safe
		// to promote once the rip is confirmed done.
		const [disc] = testDb
			.insert(discs)
			.values({
				title: "A Bug's Life",
				mediaType: 'movie',
				watchmodeId: 1,
				status: 'staged',
				stagedPath: join(stagingRoot, 'BUGSLIFE_DISK1A_PROJECT_FILE')
			})
			.returning()
			.all();
		mkdirSync(join(stagingRoot, 'BUGSLIFE_DISK1A_PROJECT_FILE'));
		writeFileSync(join(stagingRoot, 'BUGSLIFE_DISK1A_PROJECT_FILE', 'A1_t00.mkv'), 'x');

		const response = await POST(makeRequest({ stagingFolderName: 'BUGSLIFE_DISK1A_PROJECT_FILE' }));
		const data = await response.json();

		expect(data.outcome).toBe('promoted');
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

	it('persists a pipeline event when falling through to needs_review', async () => {
		await POST(makeRequest({ stagingFolderName: 'Some Unrecognized Disc' }));

		const events = testDb.select().from(pipelineEvents).all();
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe('rip_needs_review');
		expect(events[0].message).toContain('Some Unrecognized Disc');
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

	it('promotes an armed disc via the webhook, regardless of folder-name matching', async () => {
		const [disc] = testDb
			.insert(discs)
			.values({
				title: 'Criminal Minds',
				mediaType: 'tv',
				season: 3,
				watchmodeId: 1,
				status: 'not_started',
				armedAt: Date.now()
			})
			.returning()
			.all();
		mkdirSync(join(stagingRoot, 'CRIMINAL_MINDS'));
		writeFileSync(join(stagingRoot, 'CRIMINAL_MINDS', 'title_t00.mkv'), 'x');

		const response = await POST(makeRequest({ stagingFolderName: 'CRIMINAL_MINDS' }));
		const data = await response.json();

		expect(data.outcome).toBe('promoted');
		const updated = testDb
			.select()
			.from(discs)
			.all()
			.find((d) => d.id === disc.id);
		expect(updated?.status).toBe('complete');
		expect(updated?.armedAt).toBeNull();
	});

	it('promotes an armed disc even when an old, already-complete disc has the exact same stagedPath (reused MakeMKV volume label)', async () => {
		// e.g. two different physical Blu-rays both burned with the volume label
		// "CAPTAIN_AMERICA" - the old disc's stagedPath is never cleared after
		// promotion, so it must not shadow a brand new disc claiming that same
		// staging folder.
		const [oldDisc] = testDb
			.insert(discs)
			.values({
				title: 'Captain America: The Winter Soldier',
				mediaType: 'movie',
				watchmodeId: 1,
				status: 'complete',
				stagedPath: join(stagingRoot, 'CAPTAIN_AMERICA')
			})
			.returning()
			.all();
		const [newDisc] = testDb
			.insert(discs)
			.values({
				title: 'Captain America: The First Avenger',
				mediaType: 'movie',
				watchmodeId: 2,
				status: 'not_started',
				armedAt: Date.now()
			})
			.returning()
			.all();
		mkdirSync(join(stagingRoot, 'CAPTAIN_AMERICA'));
		writeFileSync(join(stagingRoot, 'CAPTAIN_AMERICA', 'title_t00.mkv'), 'x');

		const response = await POST(makeRequest({ stagingFolderName: 'CAPTAIN_AMERICA' }));
		const data = await response.json();

		expect(data.outcome).toBe('promoted');
		expect(data.discId).toBe(newDisc.id);
		const rows = testDb.select().from(discs).all();
		expect(rows.find((d) => d.id === newDisc.id)?.status).toBe('complete');
		expect(rows.find((d) => d.id === oldDisc.id)?.status).toBe('complete');
	});
});
