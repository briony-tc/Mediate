import { join } from 'node:path';
import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { discs } from '$lib/server/db/schema';
import { serverEnv } from '$lib/server/env';
import { isAuthorizedRipWebhook } from '$lib/server/webhookAuth';
import { onFileSeen } from '$lib/server/watcher/reconcile';
import { promoteToJellyfin } from '$lib/server/promote';
import { notifyAll } from '$lib/server/push';

/**
 * Called by the auto-rip script on VIKI once `makemkvcon` exits successfully
 * for a disc. This is the "rip actually finished" signal - the app's own
 * filesystem watcher can't be used for that, since it detects the staging
 * folder the moment MakeMKV *creates* it (i.e. at the start of a rip, not
 * the end).
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!isAuthorizedRipWebhook(request)) {
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

	// 'staged' is included alongside 'ripping': a disc can end up linked to
	// this exact staging path via manual "Needs attention" resolution (see
	// api/link) while the rip is still running, in which case it's 'staged'
	// (not 'ripping') by the time this webhook fires - it's just as safe to
	// promote, since stagedPath matching this absolutePath is what actually
	// confirms it's the right disc, not the status value itself.
	if (disc && (disc.status === 'ripping' || disc.status === 'staged')) {
		const result = promoteToJellyfin(disc, absolutePath);
		if (result === 'promoted') {
			await notifyAll('Rip complete', `${disc.title} filed into Jellyfin.`);
			return json({ outcome: 'promoted', discId: disc.id, mediaType: disc.mediaType });
		}
		await notifyAll(
			'Rip complete',
			`${disc.title} ripped, but couldn't be auto-filed - needs a look.`
		);
		return json({ outcome: 'needs_attention', discId: disc.id });
	}

	// Should be rare: onFileSeen's armed fast-path links unconditionally with
	// no folder-name matching required, so a disc being armed at the time this
	// fires should virtually always end up 'promoted' or 'needs_attention'
	// above, never here. If it does land here, that's worth a loud trace -
	// this exact case (armed disc, rip completed, still unmatched) happened
	// in production on 2026-08-20 with zero diagnostic trail anywhere.
	console.warn(
		`[rip-complete] "${stagingFolderName}" (${absolutePath}) finished ripping but no disc ` +
			'claimed it via onFileSeen - falling through to needs_review.'
	);
	await notifyAll('Rip complete', `"${stagingFolderName}" ripped - needs manual match.`);
	return json({ outcome: 'needs_review' });
};
