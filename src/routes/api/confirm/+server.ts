import { json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
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
	const seasonInput = Number(body?.season);
	const requestedSeason = Number.isFinite(seasonInput) ? seasonInput : null;

	if (!Number.isFinite(watchmodeId)) {
		return json({ error: 'watchmodeId is required' }, { status: 400 });
	}

	const details = await getTitleDetails(watchmodeId);
	const mediaType = toMediaType(details.type);
	// Movies don't have seasons; any season value sent for one is ignored.
	const season = mediaType === 'tv' ? requestedSeason : null;

	const existing = db
		.select()
		.from(discs)
		.where(
			and(
				eq(discs.watchmodeId, watchmodeId),
				season === null ? isNull(discs.season) : eq(discs.season, season)
			)
		)
		.get();
	if (existing) {
		return json({ error: 'This title/season is already tracked', disc: existing }, { status: 409 });
	}

	const [disc] = db
		.insert(discs)
		.values({
			title: details.title,
			mediaType,
			season,
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
