import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { discs } from '$lib/server/db/schema';

/** Cancels arming - idempotent no-op if the disc wasn't armed. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const discId = Number(body?.discId);

	if (!Number.isFinite(discId)) {
		return json({ error: 'discId is required' }, { status: 400 });
	}

	db.update(discs).set({ armedAt: null }).where(eq(discs.id, discId)).run();

	return json({ ok: true });
};
