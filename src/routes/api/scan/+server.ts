import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { lookupUpc } from '$lib/server/clients/upc';
import { searchTitlesWithFallback } from '$lib/server/clients/watchmode';
import { db } from '$lib/server/db';
import { scanEvents } from '$lib/server/db/schema';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const barcode = typeof body?.barcode === 'string' ? body.barcode.trim() : '';
	if (!barcode) {
		return json({ error: 'barcode is required' }, { status: 400 });
	}

	const upcResult = await lookupUpc(barcode);
	if (!upcResult) {
		db.insert(scanEvents).values({ barcode, outcome: 'no_upc_match' }).run();
		return json({ upcTitle: null, results: [] });
	}

	const results = await searchTitlesWithFallback(upcResult.title);
	if (results.length === 0) {
		db.insert(scanEvents)
			.values({ barcode, upcTitle: upcResult.title, outcome: 'no_watchmode_match' })
			.run();
	} else if (results.length > 1) {
		db.insert(scanEvents)
			.values({ barcode, upcTitle: upcResult.title, outcome: 'ambiguous' })
			.run();
	}

	return json({ upcTitle: upcResult.title, results });
};
