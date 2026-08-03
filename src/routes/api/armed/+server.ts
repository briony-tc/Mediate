import { json } from '@sveltejs/kit';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { discs } from '$lib/server/db/schema';
import { isAuthorizedRipWebhook } from '$lib/server/webhookAuth';

/**
 * Read-only lookup for the auto-rip script: what media type is currently
 * armed, so it can decide whether to narrow a movie rip down to just its
 * longest title instead of ripping every title MakeMKV finds. Same
 * armed-disc query reconcile.ts's fast path uses.
 */
export const GET: RequestHandler = async ({ request }) => {
	if (!isAuthorizedRipWebhook(request)) {
		return json({ error: 'unauthorized' }, { status: 401 });
	}

	const armed = db
		.select()
		.from(discs)
		.where(and(eq(discs.status, 'not_started'), isNotNull(discs.armedAt)))
		.get();

	return json({ mediaType: armed?.mediaType ?? null });
};
