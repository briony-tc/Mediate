import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { discs, unmatchedFiles } from '$lib/server/db/schema';
import { emit } from '$lib/server/events';

/**
 * Undoes a bad /api/link match (e.g. an extras subfolder linked instead of
 * the movie's own folder), OR gives up on a stuck rip - either way, resets
 * the disc back to not_started, and reverts whichever unmatchedFiles row was
 * linked to its current staged/complete path back to 'unresolved' so it
 * reappears in Needs Attention instead of staying silently consumed.
 * not_started has nothing to undo, so it's excluded. 'ripping' is allowed,
 * but only when the staging folder hasn't been touched recently (see
 * stagingFolderRecentlyActive below) - a live makemkvcon process writes to
 * its output continuously, so a folder that's gone quiet for the whole
 * safety window is a reliable enough signal that the rip is actually dead,
 * not just between titles. No force-bypass: if this check is ever wrong, the
 * only options are to wait it out or resolve it manually - deliberately
 * conservative given resetting a disc that's genuinely still ripping would
 * desync the DB from what auto-rip.sh is doing.
 *
 * Never deletes any file (staged or filed into Jellyfin), only DB state -
 * for a 'complete' TV disc this matters: episode numbering only ever counts
 * up (see promoteToJellyfin's highestExistingEpisode), so resetting one and
 * then re-ripping it without first deleting its old episode file(s) in
 * Jellyfin will file new episode numbers on top instead of replacing them,
 * duplicating the season. Movies don't have this risk - a re-rip files to
 * the same fixed filename and safely overwrites.
 */
const RIPPING_RESET_SAFETY_WINDOW_MS = 10 * 60 * 1000;

function stagingFolderRecentlyActive(stagedPath: string): boolean {
	let entries: string[];
	try {
		entries = readdirSync(stagedPath);
	} catch {
		return false; // folder's gone - nothing can be actively writing to it
	}
	const mtimes = [
		statSync(stagedPath).mtimeMs,
		...entries.map((name) => statSync(join(stagedPath, name)).mtimeMs)
	];
	return Date.now() - Math.max(...mtimes) < RIPPING_RESET_SAFETY_WINDOW_MS;
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const discId = Number(body?.discId);

	if (!Number.isFinite(discId)) {
		return json({ error: 'discId is required' }, { status: 400 });
	}

	const disc = db.select().from(discs).where(eq(discs.id, discId)).get();
	if (!disc) {
		return json({ error: 'disc not found' }, { status: 404 });
	}
	if (disc.status !== 'staged' && disc.status !== 'complete' && disc.status !== 'ripping') {
		return json(
			{ error: 'only a ripping, staged, or complete disc can be reset' },
			{ status: 409 }
		);
	}
	if (
		disc.status === 'ripping' &&
		disc.stagedPath &&
		stagingFolderRecentlyActive(disc.stagedPath)
	) {
		return json(
			{
				error:
					'this staging folder was modified in the last few minutes - the rip may still be ' +
					'active. Wait a bit and try again if it really is stuck.'
			},
			{ status: 409 }
		);
	}

	for (const path of [disc.stagedPath, disc.completePath]) {
		if (!path) continue;
		db.update(unmatchedFiles)
			.set({ resolution: 'unresolved' })
			.where(and(eq(unmatchedFiles.path, path), eq(unmatchedFiles.resolution, 'linked')))
			.run();
	}

	const now = Date.now();
	const [updated] = db
		.update(discs)
		.set({
			status: 'not_started',
			stagedPath: null,
			stagedAt: null,
			completePath: null,
			completedAt: null,
			ripTitlesCompleted: null,
			ripTitlesTotal: null,
			updatedAt: now
		})
		.where(eq(discs.id, discId))
		.returning()
		.all();

	emit({ discId: updated.id, status: updated.status, updatedAt: now });

	return json({ disc: updated });
};
