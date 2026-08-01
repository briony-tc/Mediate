import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchTitles } from '$lib/server/clients/watchmode';
import { db } from '$lib/server/db';
import { scanEvents } from '$lib/server/db/schema';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const query = typeof body?.query === 'string' ? body.query.trim() : '';
	if (!query) {
		return json({ error: 'query is required' }, { status: 400 });
	}

	const results = await searchTitles(query);
	db.insert(scanEvents).values({ upcTitle: query, outcome: 'manual_search' }).run();

	return json({ results });
};
