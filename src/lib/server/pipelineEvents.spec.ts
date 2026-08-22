import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from './db/client';
import { pipelineEvents } from './db/schema';

const testDb = createDb(':memory:');
migrate(testDb, { migrationsFolder: 'drizzle' });

vi.mock('./db', () => ({ db: testDb }));

const { logPipelineEvent } = await import('./pipelineEvents');

afterEach(() => {
	testDb.delete(pipelineEvents).run();
});

describe('logPipelineEvent', () => {
	it('persists a pipeline event with the given kind and message', () => {
		logPipelineEvent('rip_needs_review', 'CAPTAIN_AMERICA finished but no disc claimed it');

		const rows = testDb.select().from(pipelineEvents).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			kind: 'rip_needs_review',
			message: 'CAPTAIN_AMERICA finished but no disc claimed it',
			dismissedAt: null
		});
	});

	it('does not insert a second row for the same kind while one is still undismissed', () => {
		logPipelineEvent('staging_path_misconfigured', 'first');
		logPipelineEvent('staging_path_misconfigured', 'second');

		const rows = testDb.select().from(pipelineEvents).all();
		expect(rows).toHaveLength(1);
		expect(rows[0].message).toBe('first');
	});

	it('inserts a new row for the same kind once the previous one is dismissed', () => {
		logPipelineEvent('jellyfin_path_misconfigured', 'first');
		const [existing] = testDb.select().from(pipelineEvents).all();
		testDb
			.update(pipelineEvents)
			.set({ dismissedAt: Date.now() })
			.where(eq(pipelineEvents.id, existing.id))
			.run();

		logPipelineEvent('jellyfin_path_misconfigured', 'second');

		const rows = testDb.select().from(pipelineEvents).all();
		expect(rows).toHaveLength(2);
		expect(rows.find((r) => r.dismissedAt === null)?.message).toBe('second');
	});

	it('does not throw when the insert fails', () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const insertSpy = vi.spyOn(testDb, 'insert').mockImplementation(() => {
			throw new Error('db is down');
		});

		expect(() => logPipelineEvent('rip_needs_review', 'x')).not.toThrow();
		expect(errorSpy).toHaveBeenCalled();

		insertSpy.mockRestore();
		errorSpy.mockRestore();
	});
});
