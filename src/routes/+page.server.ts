import { desc, eq, ne } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { discs, unmatchedFiles } from '$lib/server/db/schema';
import { serverEnv } from '$lib/server/env';

// This is the Rip Queue page - only discs that still need pipeline action
// (not_started/ripping/staged) belong here. A completed disc has nothing
// left to do and moves to /collection instead, keeping this list from
// accumulating every title ever ripped.
export const load: PageServerLoad = async () => {
	const allDiscs = db
		.select()
		.from(discs)
		.where(ne(discs.status, 'complete'))
		.orderBy(desc(discs.updatedAt))
		.all();
	const needsAttention = db
		.select()
		.from(unmatchedFiles)
		.where(eq(unmatchedFiles.resolution, 'unresolved'))
		.orderBy(desc(unmatchedFiles.detectedAt))
		.all();

	return {
		discs: allDiscs,
		unmatchedFiles: needsAttention,
		// Public by design - the VAPID public key is meant to be handed to the
		// browser's Push API, unlike VAPID_PRIVATE_KEY.
		vapidPublicKey: serverEnv.VAPID_PUBLIC_KEY
	};
};
