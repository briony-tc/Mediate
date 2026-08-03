import { sep } from 'node:path';
import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { db } from '../db';
import { discs, unmatchedFiles } from '../db/schema';
import { AUTO_MATCH_THRESHOLD, SUGGEST_THRESHOLD, findBestDiscMatch } from '../matching/match';
import { emit } from '../events';

export type Tree = 'staging' | 'jellyfin';

type ParsedJellyfinPath =
	| { mediaType: 'movie'; title: string; season: null; year: number | null }
	| { mediaType: 'tv'; title: string; season: number | null };

type MatchCandidate = { id: number; title: string };
type MatchResult = { disc: MatchCandidate; score: number };

/** Matches "Season 1", "Season 01", "Series 1" (UK boxsets), and "S1"/"S01". */
function parseSeasonNumber(folderName: string): number | null {
	const match = folderName.match(/(?:season|series)\s*0*(\d+)/i) ?? folderName.match(/^s0*(\d+)$/i);
	return match ? Number(match[1]) : null;
}

/** Matches a trailing "(YYYY)" - the convention promoteToJellyfin now files movies under. */
function parseMovieYear(title: string): number | null {
	const match = title.match(/\((\d{4})\)\s*$/);
	return match ? Number(match[1]) : null;
}

/**
 * Jellyfin's library strictly follows movies/<title>/*.mkv and
 * tv/<title>/<season #>/*.mkv (confirmed against the real server layout).
 * TV is tracked per season, so a bare tv/<title>/ folder with no season
 * segment yet carries no actionable info and is ignored (returns null).
 */
export function parseJellyfinPath(relativePath: string): ParsedJellyfinPath | null {
	const segments = relativePath.split(sep).filter(Boolean);
	if (segments.length < 2) return null;

	const [category, title] = segments;

	if (category === 'movies') {
		return { mediaType: 'movie', title, season: null, year: parseMovieYear(title) };
	}

	if (category === 'tv') {
		if (segments.length < 3) return null;
		return { mediaType: 'tv', title, season: parseSeasonNumber(segments[2]) };
	}

	return null;
}

/**
 * Staging is MakeMKV's raw output: one flat folder per rip, named after the
 * disc's own volume label (e.g. "THE_VICAR_OF_DIBLEY_XMAS_SPECIAL") - no
 * movies/tv/season structure exists yet, that only gets created once when
 * content is moved into Jellyfin. Only the top-level rip folder is
 * meaningful; anything nested deeper inside it is ignored.
 */
export function parseStagingPath(relativePath: string): { title: string } | null {
	const segments = relativePath.split(sep).filter(Boolean);
	if (segments.length !== 1) return null;
	return { title: segments[0] };
}

function applyStatusTransition(discId: number, tree: Tree, path: string) {
	const now = Date.now();
	// Staging is detected the moment MakeMKV *creates* the destination folder -
	// i.e. at the start of a rip, not the end - so this means "actively
	// ripping", not "ripped". See /api/rip-complete for the actual completion
	// signal and the transition into 'complete'.
	const status = tree === 'staging' ? 'ripping' : 'complete';

	if (tree === 'staging') {
		// armedAt is cleared here regardless of which path led to this transition
		// (armed fast path or fuzzy-match fallback) - once a disc is actually
		// ripping, it's no longer "waiting to be armed". ripProgressPercent is
		// also reset, so a re-rip after a failed attempt doesn't show a stale
		// leftover percent from the previous try.
		db.update(discs)
			.set({
				status,
				stagedPath: path,
				stagedAt: now,
				updatedAt: now,
				armedAt: null,
				ripProgressPercent: null
			})
			.where(eq(discs.id, discId))
			.run();
	} else {
		db.update(discs)
			.set({ status, completePath: path, completedAt: now, updatedAt: now })
			.where(eq(discs.id, discId))
			.run();
	}

	emit({
		discId,
		status,
		stagedPath: tree === 'staging' ? path : undefined,
		completePath: tree === 'jellyfin' ? path : undefined,
		updatedAt: now
	});
}

/**
 * Staging's flat folder name carries no season signal, so if multiple
 * not_started rows share the exact same title (e.g. seasons 1/2/3 of the
 * same show, or a specials compilation with no obvious season), we cannot
 * safely tell which one a rip belongs to - auto-linking would guess. Those
 * cases always fall through to manual review instead.
 */
function isAutoLinkSafe(match: MatchResult, candidates: MatchCandidate[]): boolean {
	return candidates.filter((c) => c.title === match.disc.title).length === 1;
}

function recordUnmatched(
	absolutePath: string,
	tree: Tree,
	existing: typeof unmatchedFiles.$inferSelect | undefined,
	match: MatchResult | null
) {
	const bestGuessDiscId = match && match.score >= SUGGEST_THRESHOLD ? match.disc.id : null;
	const bestGuessScore = match?.score ?? null;

	if (existing) {
		db.update(unmatchedFiles)
			.set({ bestGuessDiscId, bestGuessScore })
			.where(eq(unmatchedFiles.id, existing.id))
			.run();
	} else {
		db.insert(unmatchedFiles)
			.values({ path: absolutePath, tree, bestGuessDiscId, bestGuessScore })
			.run();
	}
}

function resolveUnmatched(existing: typeof unmatchedFiles.$inferSelect | undefined) {
	if (existing) {
		db.delete(unmatchedFiles).where(eq(unmatchedFiles.id, existing.id)).run();
	}
}

/**
 * Called for every file/folder chokidar sees (both on startup baseline scan and
 * live changes). Idempotent: re-seeing a path already linked to a disc, or
 * already resolved (linked/ignored) in unmatchedFiles, is a no-op. A path
 * still sitting at 'unresolved' is retried every time, since the reason it
 * didn't match before (a matching bug, a disc not scanned in yet) can change
 * without the file itself changing - a permanently "already tried" guard
 * would leave it stuck forever even after a fix or a later scan.
 */
export function onFileSeen(absolutePath: string, relativePath: string, tree: Tree) {
	const alreadyLinked = db
		.select()
		.from(discs)
		.where(
			tree === 'staging' ? eq(discs.stagedPath, absolutePath) : eq(discs.completePath, absolutePath)
		)
		.get();
	if (alreadyLinked) return;

	const existingUnmatched = db
		.select()
		.from(unmatchedFiles)
		.where(eq(unmatchedFiles.path, absolutePath))
		.get();
	if (existingUnmatched && existingUnmatched.resolution !== 'unresolved') return;

	if (tree === 'jellyfin') {
		const parsed = parseJellyfinPath(relativePath);
		if (!parsed) return;

		// Jellyfin is authoritative proof of completion regardless of whether
		// staging was ever observed for this disc (e.g. content ripped/placed
		// before this app existed, then scanned in afterward). 'complete' is
		// included too: the top-of-function alreadyLinked check only catches an
		// unchanged completePath, so a disc whose Jellyfin folder gets renamed
		// after completion (e.g. manual tidying to match Jellyfin's naming
		// conventions) needs to still be a match candidate here, or the rename
		// looks unmatched forever instead of just updating completePath.
		const conditions = [
			eq(discs.mediaType, parsed.mediaType),
			inArray(discs.status, ['not_started', 'ripping', 'staged', 'complete'])
		];
		if (parsed.mediaType === 'tv') {
			conditions.push(
				parsed.season === null ? isNull(discs.season) : eq(discs.season, parsed.season)
			);
		} else if (parsed.year !== null) {
			// Disambiguates multiple discs sharing a title but different release
			// years (e.g. several physical releases of the same film). A disc
			// with no stored year is still treated as a plausible candidate
			// rather than excluded - this only needs to rule out a *different*,
			// known-year match, not everything without one (this is what lets an
			// older, year-less disc still re-match a folder later renamed to
			// follow the "Title (Year)" convention).
			// non-null: two arguments are always passed, so `or` never returns undefined here
			conditions.push(or(eq(discs.year, parsed.year), isNull(discs.year))!);
		}
		const candidates = db
			.select()
			.from(discs)
			.where(and(...conditions))
			.all();

		const match = findBestDiscMatch(parsed.title, candidates);

		if (match && match.score >= AUTO_MATCH_THRESHOLD) {
			applyStatusTransition(match.disc.id, tree, absolutePath);
			resolveUnmatched(existingUnmatched);
			return;
		}

		recordUnmatched(absolutePath, tree, existingUnmatched, match);
		return;
	}

	const parsed = parseStagingPath(relativePath);
	if (!parsed) return;

	// If the user armed a disc in the UI before inserting it, trust that
	// completely - link to it unconditionally, no fuzzy matching, regardless of
	// what MakeMKV named the folder. This is the whole point of arming: it
	// removes the guesswork (and the ambiguous/wrong-guess cases) that fuzzy
	// matching on folder name alone can't avoid.
	const armed = db
		.select()
		.from(discs)
		.where(and(eq(discs.status, 'not_started'), isNotNull(discs.armedAt)))
		.get();

	if (armed) {
		applyStatusTransition(armed.id, tree, absolutePath);
		resolveUnmatched(existingUnmatched);
		return;
	}

	const candidates = db.select().from(discs).where(eq(discs.status, 'not_started')).all();
	const match = findBestDiscMatch(parsed.title, candidates);

	if (match && match.score >= AUTO_MATCH_THRESHOLD && isAutoLinkSafe(match, candidates)) {
		applyStatusTransition(match.disc.id, tree, absolutePath);
		resolveUnmatched(existingUnmatched);
		return;
	}

	recordUnmatched(absolutePath, tree, existingUnmatched, match);
}
