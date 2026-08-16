import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { discs, unmatchedFiles } from '$lib/server/db/schema';
import { emit } from '$lib/server/events';
import { promoteToJellyfin } from '$lib/server/promote';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const unmatchedFileId = Number(body?.unmatchedFileId);
	const discId = Number(body?.discId);

	if (!Number.isFinite(unmatchedFileId) || !Number.isFinite(discId)) {
		return json({ error: 'unmatchedFileId and discId are required' }, { status: 400 });
	}

	const unmatchedFile = db
		.select()
		.from(unmatchedFiles)
		.where(eq(unmatchedFiles.id, unmatchedFileId))
		.get();
	if (!unmatchedFile) {
		return json({ error: 'unmatched file not found' }, { status: 404 });
	}

	const now = Date.now();
	let disc: typeof discs.$inferSelect | undefined;

	if (unmatchedFile.tree === 'staging') {
		// A staging folder only ever gets auto-filed by /api/rip-complete, fired
		// once by auto-rip.sh right after the rip finishes. A folder that's
		// still unmatched at that point (no disc existed yet to link it to)
		// never gets another chance at promotion - so unlike the jellyfin-tree
		// case below (where the file is already sitting in place), this has to
		// actually call promoteToJellyfin itself, or the disc would sit at
		// 'staged' ("needs attention") forever despite being "linked".
		[disc] = db
			.update(discs)
			.set({ stagedPath: unmatchedFile.path, stagedAt: now, updatedAt: now })
			.where(eq(discs.id, discId))
			.returning()
			.all();
		if (!disc) {
			return json({ error: 'disc not found' }, { status: 404 });
		}
		// Sets status to 'complete' (and emits) on success, or back to 'staged'
		// (and emits) if the folder has no rippable files / a filesystem error -
		// either way this disc's final state is settled by the time it returns.
		promoteToJellyfin(disc, unmatchedFile.path);
		disc = db.select().from(discs).where(eq(discs.id, discId)).get();
	} else {
		[disc] = db
			.update(discs)
			.set({
				status: 'complete',
				completePath: unmatchedFile.path,
				completedAt: now,
				updatedAt: now
			})
			.where(eq(discs.id, discId))
			.returning()
			.all();
		if (!disc) {
			return json({ error: 'disc not found' }, { status: 404 });
		}
		emit({ discId: disc.id, status: disc.status, completePath: disc.completePath, updatedAt: now });
	}

	db.update(unmatchedFiles)
		.set({ resolution: 'linked' })
		.where(eq(unmatchedFiles.id, unmatchedFileId))
		.run();

	return json({ disc });
};
