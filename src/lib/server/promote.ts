import {
	copyFileSync,
	mkdirSync,
	readdirSync,
	renameSync,
	rmdirSync,
	statSync,
	unlinkSync
} from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { discs, unmatchedFiles, type Disc } from './db/schema';
import { serverEnv } from './env';
import { emit } from './events';
import { logPipelineEvent } from './pipelineEvents';

export type PromoteResult = 'promoted' | 'needs_attention';

function sanitizeForFilename(title: string): string {
	return title.replace(/[/\\:*?"<>|]/g, '').trim();
}

/**
 * Includes the release year so discs with the same title but different years
 * (e.g. multiple physical releases of the same film) file into distinct
 * folders instead of colliding. Falls back to the bare title when the year is
 * unknown - rare, but Watchmode doesn't guarantee one.
 */
function movieFolderName(disc: Disc): string {
	const safeTitle = sanitizeForFilename(disc.title);
	return disc.year ? `${safeTitle} (${disc.year})` : safeTitle;
}

function episodeFileName(title: string, season: number, episode: number): string {
	const s = String(season).padStart(2, '0');
	const e = String(episode).padStart(2, '0');
	return `${title} - S${s}E${e}.mkv`;
}

/** Highest episode number already filed for this season, or 0 if none/folder is new. */
function highestExistingEpisode(destDir: string, season: number): number {
	let names: string[];
	try {
		names = readdirSync(destDir);
	} catch {
		return 0;
	}

	const seasonTag = `S${String(season).padStart(2, '0')}E`;
	let max = 0;
	for (const name of names) {
		const idx = name.indexOf(seasonTag);
		if (idx === -1) continue;
		const match = name.slice(idx + seasonTag.length).match(/^(\d+)/);
		if (match) max = Math.max(max, Number(match[1]));
	}
	return max;
}

/**
 * auto-rip.sh's own title-length filter (>= 10 minutes) is deliberately
 * inclusive - a movie disc can have long, legitimate bonus content worth
 * keeping (see the comment above it), so it can't just raise its own
 * threshold without also excluding real bonus features. But a real TV
 * season's episodes are normally close to uniform length, so a ripped title
 * dramatically smaller than the rest of the same disc's batch (e.g. a
 * ~12min "next time on" reel bundled alongside four ~40min episodes) is far
 * more likely bonus content that slipped past that filter than a genuine
 * short episode - unlike movies, TV numbering has no "extras" bucket to put
 * it in, so left unguarded it silently becomes a phantom episode instead.
 * Needs at least 3 files for "smaller than the rest" to mean anything -
 * with fewer, there's too little signal to safely flag anything.
 */
function findSizeOutlier(dir: string, names: string[]): string | null {
	if (names.length < 3) return null;
	const sizes = names
		.map((name) => ({ name, size: statSync(join(dir, name)).size }))
		.sort((a, b) => a.size - b.size);
	const median = sizes[Math.floor(sizes.length / 2)].size;
	return sizes[0].size < median * 0.5 ? sizes[0].name : null;
}

/**
 * STAGING_PATH and JELLYFIN_PATH are expected to be on the same underlying
 * filesystem (confirmed on VIKI: both are subfolders of /mnt/storage/media),
 * so a plain rename is normally an instant metadata-only move. Falling back
 * to copy+delete on EXDEV keeps this from hard-failing if that ever isn't
 * true (e.g. a differently laid out host).
 */
function moveFile(from: string, to: string): void {
	try {
		renameSync(from, to);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
		copyFileSync(from, to);
		unlinkSync(from);
	}
}

function removeIfEmpty(dir: string): void {
	if (readdirSync(dir).length === 0) {
		rmdirSync(dir);
	}
}

/**
 * 'staged' is repurposed for exactly this case: a disc we know finished
 * ripping (matched, out of 'ripping' status) but couldn't be auto-filed
 * cleanly - as distinct from 'ripping' (still in progress) or a disc that
 * was never matched at all (stays 'not_started', tracked via unmatchedFiles).
 */
function markNeedsAttention(disc: Disc): PromoteResult {
	const now = Date.now();
	db.update(discs).set({ status: 'staged', updatedAt: now }).where(eq(discs.id, disc.id)).run();
	emit({ discId: disc.id, status: 'staged', updatedAt: now });
	return 'needs_attention';
}

/**
 * Moves a finished rip out of staging and into the Jellyfin movies/tv tree,
 * renamed to match the disc's confirmed title. Only called once a staging
 * folder has already been confidently auto-matched to a disc (see
 * reconcile.ts's AUTO_MATCH_THRESHOLD) - this function doesn't make matching
 * decisions, only files an already-confirmed disc.
 */
export function promoteToJellyfin(disc: Disc, stagingFolderAbsolutePath: string): PromoteResult {
	let files: string[];
	try {
		files = readdirSync(stagingFolderAbsolutePath)
			.filter((name) => name.toLowerCase().endsWith('.mkv'))
			.sort();
	} catch (err) {
		console.error(`[promote] could not read staging folder for disc ${disc.id}:`, err);
		return markNeedsAttention(disc);
	}

	if (files.length === 0) return markNeedsAttention(disc);

	try {
		const safeTitle = sanitizeForFilename(disc.title);
		let completePath: string;

		if (disc.mediaType === 'movie') {
			// Largest file is the main feature. Anything else that reached
			// staging already cleared the auto-rip script's own length filter
			// (see scripts/auto-rip.sh - it skips anything under 10 minutes
			// before ripping at all), so it's presumed worth keeping rather
			// than junk - moved into Jellyfin's "behind the scenes" convention
			// (a recognized extras subfolder name, auto-shown as Special
			// Features on the movie's page) instead of being deleted.
			const [largest, ...extras] = files
				.map((name) => ({ name, size: statSync(join(stagingFolderAbsolutePath, name)).size }))
				.sort((a, b) => b.size - a.size);

			const folderName = movieFolderName(disc);
			const destDir = join(serverEnv.JELLYFIN_PATH, 'movies', folderName);
			mkdirSync(destDir, { recursive: true });
			// disc.discNumber set: this is one part of a film split across
			// multiple discs, not a standalone movie - use Jellyfin's documented
			// multi-part naming (<bare title, no year>-cd<N>.ext) so Jellyfin
			// stacks the parts into one entry instead of the fixed single
			// filename, which would let disc 2 overwrite disc 1.
			const featureFileName =
				disc.discNumber !== null ? `${safeTitle}-cd${disc.discNumber}.mkv` : `${folderName}.mkv`;
			completePath = join(destDir, featureFileName);
			moveFile(join(stagingFolderAbsolutePath, largest.name), completePath);

			if (extras.length > 0) {
				const extrasDir = join(destDir, 'behind the scenes');
				mkdirSync(extrasDir, { recursive: true });
				// Disc-number tag avoids a later disc's extras overwriting an
				// earlier disc's, since both would otherwise reuse the same
				// index-based suffix independently per promote() call.
				const discTag = disc.discNumber !== null ? ` (Disc ${disc.discNumber})` : '';
				extras.forEach((extra, index) => {
					const suffix = extras.length === 1 ? '' : ` ${index + 1}`;
					moveFile(
						join(stagingFolderAbsolutePath, extra.name),
						join(extrasDir, `${folderName} - Behind the Scenes${discTag}${suffix}.mkv`)
					);
				});
			}
		} else {
			// A TV disc without a season can't be filed - auto-link already
			// requires one (see reconcile.ts), so this shouldn't happen in
			// practice, but flag for manual review rather than guess.
			if (disc.season === null) return markNeedsAttention(disc);
			const season = disc.season;

			const destDir = join(serverEnv.JELLYFIN_PATH, 'tv', safeTitle, `Season ${season}`);
			mkdirSync(destDir, { recursive: true });

			const outlierName = findSizeOutlier(stagingFolderAbsolutePath, files);
			const episodeFiles = outlierName ? files.filter((name) => name !== outlierName) : files;

			// Numbered in disc/track order, continuing from whatever episode
			// numbers already exist in this season's folder - so a season split
			// across multiple discs keeps counting up instead of restarting at
			// E01 each time. Relies on discs being ripped in disc order (the UI
			// warns before arming a later disc while an earlier one isn't
			// complete yet) - this only looks at what's on disk, not discNumber.
			const startingEpisode = highestExistingEpisode(destDir, season) + 1;
			episodeFiles.forEach((name, index) => {
				moveFile(
					join(stagingFolderAbsolutePath, name),
					join(destDir, episodeFileName(safeTitle, season, startingEpisode + index))
				);
			});
			completePath = destDir;

			if (outlierName) {
				// Left behind in staging (not moved, not numbered as an episode) -
				// surfaces in the existing "Needs attention" list for a human to
				// look at, same as any other unmatched staging file, rather than
				// guessing whether it's disposable.
				const outlierPath = join(stagingFolderAbsolutePath, outlierName);
				db.insert(unmatchedFiles).values({ path: outlierPath, tree: 'staging' }).run();
				logPipelineEvent(
					'tv_bonus_content_excluded',
					`"${outlierName}" from ${disc.title} looked like bonus content (much shorter than ` +
						`the rest of the batch) - held out of episode numbering, left in Needs Attention ` +
						`at ${outlierPath}.`
				);
			}
		}

		removeIfEmpty(stagingFolderAbsolutePath);

		const now = Date.now();
		db.update(discs)
			.set({ status: 'complete', completePath, completedAt: now, updatedAt: now })
			.where(eq(discs.id, disc.id))
			.run();

		emit({ discId: disc.id, status: 'complete', completePath, updatedAt: now });
		return 'promoted';
	} catch (err) {
		console.error(`[promote] failed to file disc ${disc.id} into Jellyfin:`, err);
		return markNeedsAttention(disc);
	}
}
