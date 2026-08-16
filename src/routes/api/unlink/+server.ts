import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { discs, unmatchedFiles } from '$lib/server/db/schema';
import { emit } from '$lib/server/events';

/**
 * Undoes a bad /api/link match (e.g. an extras subfolder linked instead of
 * the movie's own folder) - resets the disc back to not_started, and reverts
 * whichever unmatchedFiles row was linked to its current staged/complete path
 * back to 'unresolved' so it reappears in Needs Attention instead of staying
 * silently consumed. Restricted to staged/complete discs: not_started has
 * nothing to undo, and 'ripping' means makemkvcon is actively writing to that
 * staging folder right now - unlinking mid-rip would desync the DB from what
 * auto-rip.sh is doing.
 */
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
	if (disc.status !== 'staged' && disc.status !== 'complete') {
		return json({ error: 'only a staged or complete disc can be unlinked' }, { status: 409 });
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
