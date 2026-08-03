import { join } from 'node:path';
import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { discs } from '$lib/server/db/schema';
import { serverEnv } from '$lib/server/env';
import { isAuthorizedRipWebhook } from '$lib/server/webhookAuth';
import { emit } from '$lib/server/events';

/**
 * Called by the auto-rip script roughly every 30s while makemkvcon is still
 * ripping, so the UI can show a live "time remaining" estimate. Unlike
 * /api/rip-complete, an unmatched or stale-status update is expected (not
 * exceptional) - the script's background progress reporter can race the tail
 * end of the rip finishing, so this responds 200 rather than erroring.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!isAuthorizedRipWebhook(request)) {
		return json({ error: 'unauthorized' }, { status: 401 });
	}

	const body = await request.json();
	const stagingFolderName: string | undefined = body?.stagingFolderName;
	const percent = Number(body?.percent);

	if (!stagingFolderName) {
		return json({ error: 'stagingFolderName is required' }, { status: 400 });
	}
	if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
		return json({ error: 'percent must be a number between 0 and 100' }, { status: 400 });
	}

	const absolutePath = join(serverEnv.STAGING_PATH, stagingFolderName);
	const disc = db.select().from(discs).where(eq(discs.stagedPath, absolutePath)).get();

	if (!disc || disc.status !== 'ripping') {
		return json({ outcome: 'ignored' });
	}

	const now = Date.now();
	db.update(discs)
		.set({ ripProgressPercent: percent, updatedAt: now })
		.where(eq(discs.id, disc.id))
		.run();

	emit({ discId: disc.id, status: 'ripping', ripProgressPercent: percent, updatedAt: now });

	return json({ outcome: 'updated' });
};
