import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { discs, pipelineEvents, unmatchedFiles } from '$lib/server/db/schema';
import { serverEnv } from '$lib/server/env';

// This is the Rip Queue page - only discs that still need pipeline action
// (not_started/ripping/staged) belong here. A completed disc has nothing
// left to do and moves to /collection instead, keeping this list from
// accumulating every title ever ripped. Also restricted to ownership
// 'owned': a 'wanted'/'digital_only' disc has no physical copy to rip, so it
// can never actually progress through this pipeline - it belongs on
// /collection's wishlist view only, not here.
export const load: PageServerLoad = async () => {
	const allDiscs = db
		.select()
		.from(discs)
		.where(and(ne(discs.status, 'complete'), eq(discs.ownership, 'owned')))
		.orderBy(desc(discs.updatedAt))
		.all();
	const needsAttention = db
		.select()
		.from(unmatchedFiles)
		.where(eq(unmatchedFiles.resolution, 'unresolved'))
		.orderBy(desc(unmatchedFiles.detectedAt))
		.all();
	const recentIssues = db
		.select()
		.from(pipelineEvents)
		.where(isNull(pipelineEvents.dismissedAt))
		.orderBy(desc(pipelineEvents.createdAt))
		.limit(20)
		.all();

	return {
		discs: allDiscs,
		unmatchedFiles: needsAttention,
		pipelineEvents: recentIssues,
		// Public by design - the VAPID public key is meant to be handed to the
		// browser's Push API, unlike VAPID_PRIVATE_KEY.
		vapidPublicKey: serverEnv.VAPID_PUBLIC_KEY
	};
};
