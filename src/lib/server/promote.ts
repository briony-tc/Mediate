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
import { discs, type Disc } from './db/schema';
import { serverEnv } from './env';
import { emit } from './events';

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
			completePath = join(destDir, `${folderName}.mkv`);
			moveFile(join(stagingFolderAbsolutePath, largest.name), completePath);

			if (extras.length > 0) {
				const extrasDir = join(destDir, 'behind the scenes');
				mkdirSync(extrasDir, { recursive: true });
				extras.forEach((extra, index) => {
					const suffix = extras.length === 1 ? '' : ` ${index + 1}`;
					moveFile(
						join(stagingFolderAbsolutePath, extra.name),
						join(extrasDir, `${folderName} - Behind the Scenes${suffix}.mkv`)
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
			// Numbered in disc/track order starting at E01. Known limitation: a
			// season split across multiple discs restarts at E01 for each disc,
			// since nothing in the schema tracks a starting episode offset.
			files.forEach((name, index) => {
				moveFile(
					join(stagingFolderAbsolutePath, name),
					join(destDir, episodeFileName(safeTitle, season, index + 1))
				);
			});
			completePath = destDir;
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
