import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { discs, unmatchedFiles } from '$lib/server/db/schema';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const discId = Number(body?.discId);

	if (!Number.isFinite(discId)) {
		return json({ error: 'discId is required' }, { status: 400 });
	}

	// unmatchedFiles.bestGuessDiscId has a foreign key on discs.id (enforced -
	// better-sqlite3 defaults PRAGMA foreign_keys ON), so any referencing row
	// must be cleared before the disc can be deleted. A file manually linked
	// to this disc (via /api/link) has its row set to resolution 'linked'
	// rather than deleted - the watcher's idempotency guard treats any
	// non-'unresolved' row as permanently settled, so deleting it here is what
	// makes the file re-matchable instead of stuck referencing a dead disc.
	// unresolved/ignored rows just have the stale guess cleared; they keep
	// their place in "needs attention" (or stay ignored) and get a fresh
	// guess on the next scan.
	db.delete(unmatchedFiles)
		.where(and(eq(unmatchedFiles.bestGuessDiscId, discId), eq(unmatchedFiles.resolution, 'linked')))
		.run();
	db.update(unmatchedFiles)
		.set({ bestGuessDiscId: null, bestGuessScore: null })
		.where(eq(unmatchedFiles.bestGuessDiscId, discId))
		.run();

	const [row] = db.delete(discs).where(eq(discs.id, discId)).returning().all();

	if (!row) {
		return json({ error: 'disc not found' }, { status: 404 });
	}

	return json({ disc: row });
};
