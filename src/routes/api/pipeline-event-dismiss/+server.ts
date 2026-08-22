import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { pipelineEvents } from '$lib/server/db/schema';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const pipelineEventId = Number(body?.pipelineEventId);

	if (!Number.isFinite(pipelineEventId)) {
		return json({ error: 'pipelineEventId is required' }, { status: 400 });
	}

	const [row] = db
		.update(pipelineEvents)
		.set({ dismissedAt: Date.now() })
		.where(eq(pipelineEvents.id, pipelineEventId))
		.returning()
		.all();

	if (!row) {
		return json({ error: 'pipeline event not found' }, { status: 404 });
	}

	return json({ pipelineEvent: row });
};
