import { sep } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { discs, unmatchedFiles } from '../db/schema';
import { AUTO_MATCH_THRESHOLD, SUGGEST_THRESHOLD, findBestDiscMatch } from '../matching/match';
import { emit } from '../events';

export type Tree = 'staging' | 'jellyfin';

/**
 * Both STAGING_PATH and JELLYFIN_PATH follow movies/<title>/*.mkv and
 * tv/<title>/<season #>/*.mkv - only the first two segments matter for matching.
 */
export function parseMediaPath(
	relativePath: string
): { mediaType: 'movie' | 'tv'; title: string } | null {
	const segments = relativePath.split(sep).filter(Boolean);
	if (segments.length < 2) return null;

	const [category, title] = segments;
	if (category === 'movies') return { mediaType: 'movie', title };
	if (category === 'tv') return { mediaType: 'tv', title };
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

	const candidateStatus = tree === 'staging' ? 'not_started' : 'staged';
	const candidates = db
		.select()
		.from(discs)
		.where(and(eq(discs.mediaType, parsed.mediaType), eq(discs.status, candidateStatus)))
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
