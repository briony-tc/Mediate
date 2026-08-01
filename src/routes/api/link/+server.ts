import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { discs, unmatchedFiles } from '$lib/server/db/schema';
import { emit } from '$lib/server/events';

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
	const status = unmatchedFile.tree === 'staging' ? 'staged' : 'complete';

	const [disc] = db
		.update(discs)
		.set(
			unmatchedFile.tree === 'staging'
				? { status, stagedPath: unmatchedFile.path, stagedAt: now, updatedAt: now }
				: { status, completePath: unmatchedFile.path, completedAt: now, updatedAt: now }
		)
		.where(eq(discs.id, discId))
		.returning()
		.all();

	if (!disc) {
		return json({ error: 'disc not found' }, { status: 404 });
	}

	db.update(unmatchedFiles)
		.set({ resolution: 'linked' })
		.where(eq(unmatchedFiles.id, unmatchedFileId))
		.run();

	emit({
		discId: disc.id,
		status: disc.status,
		stagedPath: unmatchedFile.tree === 'staging' ? unmatchedFile.path : undefined,
		completePath: unmatchedFile.tree === 'jellyfin' ? unmatchedFile.path : undefined,
		updatedAt: now
	});

	return json({ disc });
};
