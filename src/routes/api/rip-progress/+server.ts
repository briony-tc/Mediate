import { join } from 'node:path';
import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { discs } from '$lib/server/db/schema';
import { serverEnv } from '$lib/server/env';
import { isAuthorizedRipWebhook } from '$lib/server/webhookAuth';
import { emit } from '$lib/server/events';

/**
 * Called by the auto-rip script at each title-loop boundary (not a live
 * in-title percent - MakeMKV's own progress output isn't reliably readable
 * during the save phase, confirmed live - this is a coarser but fully
 * reliable "N of M titles" signal instead, driven by the script's own loop
 * counters rather than anything MakeMKV chooses to print). Unlike
 * /api/rip-complete, an unmatched or stale-status update is expected (not
 * exceptional) - this responds 200 rather than erroring.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!isAuthorizedRipWebhook(request)) {
		return json({ error: 'unauthorized' }, { status: 401 });
	}

	const body = await request.json();
	const stagingFolderName: string | undefined = body?.stagingFolderName;
	const titlesCompleted = Number(body?.titlesCompleted);
	const titlesTotal = Number(body?.titlesTotal);

	if (!stagingFolderName) {
		return json({ error: 'stagingFolderName is required' }, { status: 400 });
	}
	if (!Number.isInteger(titlesTotal) || titlesTotal < 1) {
		return json({ error: 'titlesTotal must be an integer >= 1' }, { status: 400 });
	}
	if (!Number.isInteger(titlesCompleted) || titlesCompleted < 0 || titlesCompleted > titlesTotal) {
		return json(
			{ error: 'titlesCompleted must be an integer between 0 and titlesTotal' },
			{ status: 400 }
		);
	}

	const absolutePath = join(serverEnv.STAGING_PATH, stagingFolderName);
	// Scoped to status='ripping' in the query itself, not just checked after -
	// MakeMKV can reuse an old, already-complete disc's staging folder name
	// (identical volume label), so matching on stagedPath alone could pick that
	// stale disc instead of the one actually ripping right now.
	const disc = db
		.select()
		.from(discs)
		.where(and(eq(discs.stagedPath, absolutePath), eq(discs.status, 'ripping')))
		.get();

	if (!disc) {
		return json({ outcome: 'ignored' });
	}

	const now = Date.now();
	db.update(discs)
		.set({ ripTitlesCompleted: titlesCompleted, ripTitlesTotal: titlesTotal, updatedAt: now })
		.where(eq(discs.id, disc.id))
		.run();

	emit({
		discId: disc.id,
		status: 'ripping',
		ripTitlesCompleted: titlesCompleted,
		ripTitlesTotal: titlesTotal,
		updatedAt: now
	});

	return json({ outcome: 'updated' });
};
