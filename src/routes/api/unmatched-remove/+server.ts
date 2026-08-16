import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { unmatchedFiles } from '$lib/server/db/schema';

/**
 * Permanently deletes an unmatchedFiles row (as opposed to /api/ignore, which
 * just marks it resolved). Only removes the tracking row, not the underlying
 * file on disk - if the physical folder is still there and still doesn't
 * match a disc, a server restart's baseline scan (or the watcher, if the
 * folder is ever touched again) will re-add it as a fresh 'unresolved' entry.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const unmatchedFileId = Number(body?.unmatchedFileId);

	if (!Number.isFinite(unmatchedFileId)) {
		return json({ error: 'unmatchedFileId is required' }, { status: 400 });
	}

	const [row] = db
		.delete(unmatchedFiles)
		.where(eq(unmatchedFiles.id, unmatchedFileId))
		.returning()
		.all();

	if (!row) {
		return json({ error: 'unmatched file not found' }, { status: 404 });
	}

	return json({ unmatchedFile: row });
};
