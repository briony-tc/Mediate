import { json } from '@sveltejs/kit';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { discs } from '$lib/server/db/schema';

/**
 * Marks a not_started disc as "the one about to be inserted" - the watcher's
 * reconcile logic then links the next staging folder to it unconditionally,
 * skipping fuzzy folder-name matching entirely. Only one disc is ever armed
 * at a time; arming a new one swaps out whichever was armed before.
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
	if (disc.status !== 'not_started') {
		return json({ error: 'only a not_started disc can be armed' }, { status: 409 });
	}
	if (disc.ownership !== 'owned') {
		return json(
			{ error: 'only an owned disc can be armed - it has no physical copy to rip' },
			{
				status: 409
			}
		);
	}

	db.update(discs)
		.set({ armedAt: null })
		.where(and(isNotNull(discs.armedAt), ne(discs.id, discId)))
		.run();

	const [updated] = db
		.update(discs)
		.set({ armedAt: Date.now() })
		.where(eq(discs.id, discId))
		.returning()
		.all();

	return json({ disc: updated });
};
