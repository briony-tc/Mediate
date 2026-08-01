import { sep } from 'node:path';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db';
import { discs, unmatchedFiles } from '../db/schema';
import { AUTO_MATCH_THRESHOLD, SUGGEST_THRESHOLD, findBestDiscMatch } from '../matching/match';
import { emit } from '../events';

export type Tree = 'staging' | 'jellyfin';

type ParsedMediaPath =
	| { mediaType: 'movie'; title: string; season: null }
	| { mediaType: 'tv'; title: string; season: number | null };

/** Matches "Season 1", "Season 01", "Series 1" (UK boxsets), and "S1"/"S01". */
function parseSeasonNumber(folderName: string): number | null {
	const match = folderName.match(/(?:season|series)\s*0*(\d+)/i) ?? folderName.match(/^s0*(\d+)$/i);
	return match ? Number(match[1]) : null;
}

/**
 * Both STAGING_PATH and JELLYFIN_PATH follow movies/<title>/*.mkv and
 * tv/<title>/<season #>/*.mkv. TV series are barcoded/tracked per season
 * (see discs.season), so a bare tv/<title>/ folder with no season segment
 * yet carries no actionable info and is ignored (returns null).
 */
export function parseMediaPath(relativePath: string): ParsedMediaPath | null {
	const segments = relativePath.split(sep).filter(Boolean);
	if (segments.length < 2) return null;

	const [category, title] = segments;

	if (category === 'movies') {
		return { mediaType: 'movie', title, season: null };
	}

	if (category === 'tv') {
		if (segments.length < 3) return null;
		return { mediaType: 'tv', title, season: parseSeasonNumber(segments[2]) };
	}

	return null;
}

function applyStatusTransition(discId: number, tree: Tree, path: string) {
	const now = Date.now();
	const status = tree === 'staging' ? 'staged' : 'complete';

	if (tree === 'staging') {
		db.update(discs)
			.set({ status, stagedPath: path, stagedAt: now, updatedAt: now })
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
 * Called for every file/folder chokidar sees (both on startup baseline scan and
 * live changes). Idempotent: re-seeing a path already linked to a disc, or
 * already recorded in unmatchedFiles, is a no-op.
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

	const alreadySeen = db
		.select()
		.from(unmatchedFiles)
		.where(eq(unmatchedFiles.path, absolutePath))
		.get();
	if (alreadySeen) return;

	const parsed = parseMediaPath(relativePath);
	if (!parsed) return;

	// Staging only promotes genuinely fresh discs. Jellyfin is authoritative
	// proof of completion regardless of whether staging was ever observed for
	// this disc (e.g. content ripped/placed before this app existed, then
	// scanned in afterward) - so it matches both not_started and staged.
	const conditions = [
		eq(discs.mediaType, parsed.mediaType),
		tree === 'staging'
			? eq(discs.status, 'not_started')
			: inArray(discs.status, ['not_started', 'staged'])
	];
	if (parsed.mediaType === 'tv') {
		conditions.push(
			parsed.season === null ? isNull(discs.season) : eq(discs.season, parsed.season)
		);
	}
	const candidates = db
		.select()
		.from(discs)
		.where(and(...conditions))
		.all();

	const match = findBestDiscMatch(parsed.title, candidates);

	if (match && match.score >= AUTO_MATCH_THRESHOLD) {
		applyStatusTransition(match.disc.id, tree, absolutePath);
		return;
	}

	db.insert(unmatchedFiles)
		.values({
			path: absolutePath,
			tree,
			bestGuessDiscId: match && match.score >= SUGGEST_THRESHOLD ? match.disc.id : null,
			bestGuessScore: match?.score ?? null
		})
		.run();
}
