import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { unmatchedFiles } from '$lib/server/db/schema';

/**
 * Reverts an accidentally-ignored file back to 'unresolved' - e.g. a digital-
 * only Jellyfin folder that got ignored before its matching disc row existed.
 * The watcher itself won't retry an 'ignored' entry (see reconcile.ts's
 * onFileSeen early-return), so this is a manual escape hatch; it doesn't
 * recompute bestGuessDiscId/Score, which may now be stale/null - the caller
 * is expected to pick the right disc manually via /api/link.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const unmatchedFileId = Number(body?.unmatchedFileId);

	if (!Number.isFinite(unmatchedFileId)) {
		return json({ error: 'unmatchedFileId is required' }, { status: 400 });
	}

	const [row] = db
		.update(unmatchedFiles)
		.set({ resolution: 'unresolved' })
		.where(eq(unmatchedFiles.id, unmatchedFileId))
		.returning()
		.all();

	if (!row) {
		return json({ error: 'unmatched file not found' }, { status: 404 });
	}

	return json({ unmatchedFile: row });
};
