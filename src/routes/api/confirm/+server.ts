import { json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { getTitleDetails, toMediaType } from '$lib/server/clients/watchmode';
import { db } from '$lib/server/db';
import { discs, scanEvents } from '$lib/server/db/schema';
import { emit } from '$lib/server/events';

const OWNERSHIP_VALUES = ['owned', 'wanted', 'digital_only'] as const;
type Ownership = (typeof OWNERSHIP_VALUES)[number];

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const watchmodeId = Number(body?.watchmodeId);
	const barcode: string | null = typeof body?.barcode === 'string' ? body.barcode : null;
	const rawLookupTitle: string | null =
		typeof body?.rawLookupTitle === 'string' ? body.rawLookupTitle : null;
	// `Number(null)` is 0, not NaN - since the client explicitly sends `null`
	// for "not provided" (rather than omitting the key), that footgun would
	// otherwise store a real 0 instead of leaving these unset.
	const seasonInput = body?.season == null ? NaN : Number(body.season);
	const requestedSeason = Number.isFinite(seasonInput) ? seasonInput : null;
	const discNumberInput = body?.discNumber == null ? NaN : Number(body.discNumber);
	const requestedDiscNumber = Number.isFinite(discNumberInput) ? discNumberInput : null;
	// Lets the whole set be documented in one submission (e.g. "this is a
	// 3-disc set") instead of adding disc 1, then reactively adding 2 and 3
	// one at a time after each 409. Anything <= 1 is just the normal single-
	// disc case.
	const discCountInput = Number(body?.discCount);
	const requestedDiscCount =
		Number.isFinite(discCountInput) && discCountInput > 1 ? Math.floor(discCountInput) : 1;
	// 'owned' by default - scanning a barcode or ripping a disc already implies
	// physical possession, so every existing caller keeps behaving exactly as
	// before. 'wanted' and 'digital_only' are opt-in (see schema.ts).
	const ownership: Ownership = OWNERSHIP_VALUES.includes(body?.ownership)
		? body.ownership
		: 'owned';

	if (!Number.isFinite(watchmodeId)) {
		return json({ error: 'watchmodeId is required' }, { status: 400 });
	}

	const details = await getTitleDetails(watchmodeId);
	const mediaType = toMediaType(details.type);
	// Movies don't have seasons; any season value sent for one is ignored.
	const season = mediaType === 'tv' ? requestedSeason : null;
	const seasonCondition = season === null ? isNull(discs.season) : eq(discs.season, season);

	const baseValues = {
		title: details.title,
		mediaType,
		season,
		ownership,
		year: details.year ?? null,
		watchmodeId: details.id,
		imdbId: details.imdbId ?? null,
		posterUrl: details.posterUrl ?? null,
		genres: JSON.stringify(details.genreNames),
		barcodeUpc: barcode,
		rawLookupTitle: rawLookupTitle
	};

	let createdDiscs: (typeof discs.$inferSelect)[];

	if (requestedDiscCount > 1) {
		// Bulk path only applies to a brand new title/season - any existing row
		// (single-disc or already part of a set) means the reactive "add another
		// disc" flow (below) is what handles it instead, to avoid guessing how
		// the new count should reconcile with what's already there.
		const existing = db
			.select()
			.from(discs)
			.where(and(eq(discs.watchmodeId, watchmodeId), seasonCondition))
			.get();
		if (existing) {
			return json(
				{ error: 'This title/season is already tracked', disc: existing },
				{ status: 409 }
			);
		}

		createdDiscs = db
			.insert(discs)
			.values(
				Array.from({ length: requestedDiscCount }, (_, i) => ({
					...baseValues,
					discNumber: i + 1
				}))
			)
			.returning()
			.all();
	} else {
		// A plain re-scan (no discNumber) of an already-tracked title/season still
		// 409s, same as always. An explicit discNumber only conflicts with a row
		// that already has that exact disc number - this is what allows adding
		// disc 2+ of a multi-disc title one at a time.
		const existing = db
			.select()
			.from(discs)
			.where(
				and(
					eq(discs.watchmodeId, watchmodeId),
					seasonCondition,
					requestedDiscNumber === null
						? isNull(discs.discNumber)
						: eq(discs.discNumber, requestedDiscNumber)
				)
			)
			.get();
		if (existing) {
			return json(
				{ error: 'This title/season is already tracked', disc: existing },
				{ status: 409 }
			);
		}

		// Turning a previously single-disc entry into "disc 1" of a set, the
		// moment a disc 2+ is explicitly added for the same title/season.
		if (requestedDiscNumber !== null) {
			const existingSingleDisc = db
				.select()
				.from(discs)
				.where(and(eq(discs.watchmodeId, watchmodeId), seasonCondition, isNull(discs.discNumber)))
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

		createdDiscs = db
			.insert(discs)
			.values({ ...baseValues, discNumber: requestedDiscNumber })
			.returning()
			.all();
	}

	db.insert(scanEvents)
		.values({
			barcode,
			upcTitle: rawLookupTitle,
			watchmodeId: details.id,
			outcome: 'linked'
		})
		.run();

	for (const disc of createdDiscs) {
		emit({ discId: disc.id, status: disc.status, updatedAt: disc.updatedAt });
	}

	return json({ disc: createdDiscs[0], discs: createdDiscs }, { status: 201 });
};
