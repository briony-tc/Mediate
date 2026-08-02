import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { discs } from '$lib/server/db/schema';
import { serverEnv } from '$lib/server/env';
import { onFileSeen } from '$lib/server/watcher/reconcile';
import { promoteToJellyfin } from '$lib/server/promote';
import { notifyAll } from '$lib/server/push';

function isAuthorized(request: Request): boolean {
	const header = request.headers.get('authorization') ?? '';
	const provided = Buffer.from(header.replace(/^Bearer\s+/i, ''));
	const expected = Buffer.from(serverEnv.RIP_WEBHOOK_SECRET);
	return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/**
 * Called by the auto-rip script on VIKI once `makemkvcon` exits successfully
 * for a disc. This is the "rip actually finished" signal - the app's own
 * filesystem watcher can't be used for that, since it detects the staging
 * folder the moment MakeMKV *creates* it (i.e. at the start of a rip, not
 * the end).
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!isAuthorized(request)) {
		return json({ error: 'unauthorized' }, { status: 401 });
	}

	const body = await request.json();
	const stagingFolderName: string | undefined = body?.stagingFolderName;
	if (!stagingFolderName) {
		return json({ error: 'stagingFolderName is required' }, { status: 400 });
	}

	const absolutePath = join(serverEnv.STAGING_PATH, stagingFolderName);

	// Reuses the exact matching/auto-link logic the passive watcher uses for
	// every other staging folder - see reconcile.ts.
	onFileSeen(absolutePath, stagingFolderName, 'staging');

	const disc = db.select().from(discs).where(eq(discs.stagedPath, absolutePath)).get();

	if (disc && disc.status === 'ripping') {
		const result = promoteToJellyfin(disc, absolutePath);
		if (result === 'promoted') {
			await notifyAll('Rip complete', `${disc.title} filed into Jellyfin.`);
			return json({ outcome: 'promoted', discId: disc.id });
		}
		await notifyAll(
			'Rip complete',
			`${disc.title} ripped, but couldn't be auto-filed - needs a look.`
		);
		return json({ outcome: 'needs_attention', discId: disc.id });
	}

	await notifyAll('Rip complete', `"${stagingFolderName}" ripped - needs manual match.`);
	return json({ outcome: 'needs_review' });
};
