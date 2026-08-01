import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { unmatchedFiles } from '$lib/server/db/schema';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const unmatchedFileId = Number(body?.unmatchedFileId);

	if (!Number.isFinite(unmatchedFileId)) {
		return json({ error: 'unmatchedFileId is required' }, { status: 400 });
	}

	const [row] = db
		.update(unmatchedFiles)
		.set({ resolution: 'ignored' })
		.where(eq(unmatchedFiles.id, unmatchedFileId))
		.returning()
		.all();

	if (!row) {
		return json({ error: 'unmatched file not found' }, { status: 404 });
	}

	return json({ unmatchedFile: row });
};
