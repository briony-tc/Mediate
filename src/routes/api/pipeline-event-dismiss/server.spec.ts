import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '$lib/server/db/client';
import { pipelineEvents } from '$lib/server/db/schema';

const testDb = createDb(':memory:');
migrate(testDb, { migrationsFolder: 'drizzle' });

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { POST } = await import('./+server');

function makeRequest(body: unknown) {
	return { request: { json: async () => body } } as Parameters<typeof POST>[0];
}

afterEach(() => {
	testDb.delete(pipelineEvents).run();
});

describe('POST /api/pipeline-event-dismiss', () => {
	it('returns 400 when pipelineEventId is missing', async () => {
		const response = await POST(makeRequest({}));
		expect(response.status).toBe(400);
	});

	it('returns 404 for an unknown id', async () => {
		const response = await POST(makeRequest({ pipelineEventId: 999 }));
		expect(response.status).toBe(404);
	});

	it('dismisses a pipeline event, setting dismissedAt', async () => {
		const [row] = testDb
			.insert(pipelineEvents)
			.values({ kind: 'rip_needs_review', message: 'x' })
			.returning()
			.all();

		const response = await POST(makeRequest({ pipelineEventId: row.id }));
		const data = await response.json();

		expect(data.pipelineEvent.dismissedAt).not.toBeNull();
	});

	it('does not affect other pipeline events', async () => {
		const [target] = testDb
			.insert(pipelineEvents)
			.values({ kind: 'rip_needs_review', message: 'target' })
			.returning()
			.all();
		const [other] = testDb
			.insert(pipelineEvents)
			.values({ kind: 'staging_path_misconfigured', message: 'other' })
			.returning()
			.all();

		await POST(makeRequest({ pipelineEventId: target.id }));

		const rows = testDb.select().from(pipelineEvents).all();
		expect(rows.find((r) => r.id === other.id)?.dismissedAt).toBeNull();
	});
});
