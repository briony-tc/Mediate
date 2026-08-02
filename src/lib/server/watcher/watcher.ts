import { existsSync, readdirSync } from 'node:fs';
import { relative, join } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { serverEnv } from '../env';
import { onFileSeen, type Tree } from './reconcile';

/**
 * Jellyfin's convention requires movies/<title>/ and tv/<title>/<season>/
 * directly under JELLYFIN_PATH - a root pointed one level too high (or too
 * low) silently matches nothing, with no error, which is very hard to
 * notice. Warn loudly at boot instead.
 */
function warnIfJellyfinPathMisconfigured(root: string) {
	if (!existsSync(join(root, 'movies')) && !existsSync(join(root, 'tv'))) {
		console.warn(
			`[watcher] JELLYFIN_PATH ("${root}") has no "movies" or "tv" subfolder. ` +
				'It must point directly at the folder that contains them - check for an extra ' +
				'nesting level (e.g. a path ending one directory too high).'
		);
	}
}

/**
 * Staging is flat (no movies/tv convention - see parseStagingPath), so the
 * best available sanity check is existence/non-emptiness. This also catches
 * the case where a Docker bind mount's host source path doesn't actually
 * exist: Docker silently creates an empty directory instead of erroring.
 */
function warnIfStagingPathMisconfigured(root: string) {
	if (!existsSync(root) || readdirSync(root).length === 0) {
		console.warn(
			`[watcher] STAGING_PATH ("${root}") does not exist or is empty. If this is a Docker ` +
				'bind mount, a missing host source path is silently mounted as an empty directory ' +
				'instead of erroring - double check the real host path is correct.'
		);
	}
}

/**
 * Only 'addDir' is watched, not 'add': individual files live one level
 * deeper than depth allows, so a folder's own creation is the signal we
 * react to - matching happens at folder granularity, not per-file.
 */
function watchTree(root: string, tree: Tree, depth: number): FSWatcher {
	const watcher = watch(root, {
		depth,
		ignoreInitial: false,
		awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 200 }
	});

	watcher.on('addDir', (absolutePath: string) => {
		onFileSeen(absolutePath, relative(root, absolutePath), tree);
	});

	return watcher;
}

const g = globalThis as unknown as { __mediaLibraryWatchers?: FSWatcher[] };

export function startWatcher() {
	if (g.__mediaLibraryWatchers) return;

	warnIfStagingPathMisconfigured(serverEnv.STAGING_PATH);
	warnIfJellyfinPathMisconfigured(serverEnv.JELLYFIN_PATH);

	g.__mediaLibraryWatchers = [
		// Staging is flat (one rip folder per disc) - depth 1 is enough.
		watchTree(serverEnv.STAGING_PATH, 'staging', 1),
		// Jellyfin needs movies/<title>/ (2) and tv/<title>/<season>/ (3).
		watchTree(serverEnv.JELLYFIN_PATH, 'jellyfin', 3)
	];
}

export async function stopWatcher() {
	if (!g.__mediaLibraryWatchers) return;
	await Promise.all(g.__mediaLibraryWatchers.map((watcher) => watcher.close()));
	g.__mediaLibraryWatchers = undefined;
}
