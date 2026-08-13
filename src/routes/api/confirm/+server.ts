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
	const discNumberInput = Number(body?.discNumber);
	const requestedDiscNumber = Number.isFinite(discNumberInput) ? discNumberInput : null;

	if (!Number.isFinite(watchmodeId)) {
		return json({ error: 'watchmodeId is required' }, { status: 400 });
	}

	const details = await getTitleDetails(watchmodeId);
	const mediaType = toMediaType(details.type);
	// Movies don't have seasons; any season value sent for one is ignored.
	const season = mediaType === 'tv' ? requestedSeason : null;

	// A plain re-scan (no discNumber) of an already-tracked title/season still
	// 409s, same as always. An explicit discNumber only conflicts with a row
	// that already has that exact disc number - this is what allows adding
	// disc 2+ of a multi-disc title.
	const existing = db
		.select()
		.from(discs)
		.where(
			and(
				eq(discs.watchmodeId, watchmodeId),
				season === null ? isNull(discs.season) : eq(discs.season, season),
				requestedDiscNumber === null
					? isNull(discs.discNumber)
					: eq(discs.discNumber, requestedDiscNumber)
			)
		)
		.get();
	if (existing) {
		return json({ error: 'This title/season is already tracked', disc: existing }, { status: 409 });
	}

	// Turning a previously single-disc entry into "disc 1" of a set, the
	// moment a disc 2+ is explicitly added for the same title/season.
	if (requestedDiscNumber !== null) {
		const existingSingleDisc = db
			.select()
			.from(discs)
			.where(
				and(
					eq(discs.watchmodeId, watchmodeId),
					season === null ? isNull(discs.season) : eq(discs.season, season),
					isNull(discs.discNumber)
				)
			)
			.get();
		if (existingSingleDisc) {
			db.update(discs)
				.set({ discNumber: 1, updatedAt: Date.now() })
				.where(eq(discs.id, existingSingleDisc.id))
				.run();
			emit({
				discId: existingSingleDisc.id,
				status: existingSingleDisc.status,
				updatedAt: Date.now()
			});
		}
	}

	const [disc] = db
		.insert(discs)
		.values({
			title: details.title,
			mediaType,
			season,
			discNumber: requestedDiscNumber,
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
