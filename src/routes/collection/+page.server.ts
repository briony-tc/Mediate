import { desc, eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { discs, unmatchedFiles } from '$lib/server/db/schema';

export const load: PageServerLoad = async () => {
	const ignoredFiles = db
		.select()
		.from(unmatchedFiles)
		.where(eq(unmatchedFiles.resolution, 'ignored'))
		.orderBy(desc(unmatchedFiles.detectedAt))
		.all();

	return {
		discs: db.select().from(discs).orderBy(desc(discs.updatedAt)).all(),
		ignoredFiles
	};
};
