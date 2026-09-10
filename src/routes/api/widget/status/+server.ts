import { json } from '@sveltejs/kit';
import { eq, isNotNull } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { discs } from '$lib/server/db/schema';

/**
 * Small, unauthenticated status summary polled by the Android home-screen
 * widget (and anything else that just wants "what's happening right now"
 * without the full rip-queue page load). Same no-auth model as the rest of
 * the app - this is trusted-home-network-only, like everything else here.
 */
export const GET: RequestHandler = async () => {
	const armed = db.select().from(discs).where(isNotNull(discs.armedAt)).get();
	const ripping = db.select().from(discs).where(eq(discs.status, 'ripping')).get();

	return json({
		armed: armed
			? {
					id: armed.id,
					title: armed.title,
					mediaType: armed.mediaType,
					season: armed.season,
					discNumber: armed.discNumber
				}
			: null,
		ripping: ripping
			? {
					id: ripping.id,
					title: ripping.title,
					mediaType: ripping.mediaType,
					ripTitlesCompleted: ripping.ripTitlesCompleted,
					ripTitlesTotal: ripping.ripTitlesTotal
				}
			: null
	});
};
