import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTitleDetails } from '$lib/server/clients/watchmode';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const watchmodeId = Number(body?.watchmodeId);
	if (!Number.isFinite(watchmodeId)) {
		return json({ error: 'watchmodeId is required' }, { status: 400 });
	}

	const details = await getTitleDetails(watchmodeId);
	return json({ details });
};
