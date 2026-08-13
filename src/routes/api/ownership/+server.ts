import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { discs } from '$lib/server/db/schema';
import { emit } from '$lib/server/events';

const OWNERSHIP_VALUES = ['owned', 'wanted', 'digital_only'] as const;

/**
 * Direct ownership toggle - e.g. registering a digital-only title, or
 * correcting a mistake. The other, more common way ownership changes is
 * automatic: reconcile.ts's applyStatusTransition flips 'wanted' to 'owned'
 * the moment a real disc starts ripping, with no user action needed.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const discId = Number(body?.discId);
	const ownership = body?.ownership;

	if (!Number.isFinite(discId)) {
		return json({ error: 'discId is required' }, { status: 400 });
	}
	if (!OWNERSHIP_VALUES.includes(ownership)) {
		return json(
			{ error: `ownership must be one of: ${OWNERSHIP_VALUES.join(', ')}` },
			{ status: 400 }
		);
	}

	const disc = db.select().from(discs).where(eq(discs.id, discId)).get();
	if (!disc) {
		return json({ error: 'disc not found' }, { status: 404 });
	}

	const now = Date.now();
	const [updated] = db
		.update(discs)
		.set({ ownership, updatedAt: now })
		.where(eq(discs.id, discId))
		.returning()
		.all();

	emit({ discId: updated.id, status: updated.status, updatedAt: now });

	return json({ disc: updated });
};
