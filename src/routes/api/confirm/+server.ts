import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { getTitleDetails, toMediaType } from '$lib/server/clients/watchmode';
import { db } from '$lib/server/db';
import { discs, scanEvents } from '$lib/server/db/schema';
import { emit } from '$lib/server/events';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const watchmodeId = Number(body?.watchmodeId);
	const barcode: string | null = typeof body?.barcode === 'string' ? body.barcode : null;
	const rawLookupTitle: string | null =
		typeof body?.rawLookupTitle === 'string' ? body.rawLookupTitle : null;

	if (!Number.isFinite(watchmodeId)) {
		return json({ error: 'watchmodeId is required' }, { status: 400 });
	}

	const existing = db.select().from(discs).where(eq(discs.watchmodeId, watchmodeId)).get();
	if (existing) {
		return json({ error: 'This title is already tracked', disc: existing }, { status: 409 });
	}

	const details = await getTitleDetails(watchmodeId);

	const [disc] = db
		.insert(discs)
		.values({
			title: details.title,
			mediaType: toMediaType(details.type),
			year: details.year ?? null,
			watchmodeId: details.id,
			imdbId: details.imdbId ?? null,
			posterUrl: details.posterUrl ?? null,
			genres: JSON.stringify(details.genreNames),
			barcodeUpc: barcode,
			rawLookupTitle: rawLookupTitle
		})
		.returning()
		.all();

	db.insert(scanEvents)
		.values({
			barcode,
			upcTitle: rawLookupTitle,
			watchmodeId: details.id,
			outcome: 'linked'
		})
		.run();

	emit({ discId: disc.id, status: disc.status, updatedAt: disc.updatedAt });

	return json({ disc }, { status: 201 });
};
