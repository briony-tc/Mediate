import { existsSync } from 'node:fs';
import { relative, join } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { serverEnv } from '../env';
import { onFileSeen, type Tree } from './reconcile';

/**
 * The convention requires movies/<title>/ and tv/<title>/<season>/ directly
 * under STAGING_PATH/JELLYFIN_PATH - a root pointed one level too high (or
 * too low) silently matches nothing, with no error, which is very hard to
 * notice. Warn loudly at boot instead.
 */
function warnIfMisconfigured(root: string, label: string) {
	if (!existsSync(join(root, 'movies')) && !existsSync(join(root, 'tv'))) {
		console.warn(
			`[watcher] ${label} ("${root}") has no "movies" or "tv" subfolder. ` +
				'It must point directly at the folder that contains them - check for an extra ' +
				'nesting level (e.g. a path ending one directory too high).'
		);
	}
}

/**
 * Only 'addDir' is watched, not 'add': individual files live one level
 * deeper than depth allows, so a folder's own creation is the signal we
 * react to - matching happens at folder granularity, not per-file. Depth 3
 * covers movies/<title>/ (2 levels) and tv/<title>/<season>/ (3 levels) -
 * TV is tracked per season (see discs.season), so the season folder itself
 * needs to be visible, not just the show folder above it.
 */
function watchTree(root: string, tree: Tree): FSWatcher {
	const watcher = watch(root, {
		depth: 3,
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

	warnIfMisconfigured(serverEnv.STAGING_PATH, 'STAGING_PATH');
	warnIfMisconfigured(serverEnv.JELLYFIN_PATH, 'JELLYFIN_PATH');

	g.__mediaLibraryWatchers = [
		watchTree(serverEnv.STAGING_PATH, 'staging'),
		watchTree(serverEnv.JELLYFIN_PATH, 'jellyfin')
	];
}

export async function stopWatcher() {
	if (!g.__mediaLibraryWatchers) return;
	await Promise.all(g.__mediaLibraryWatchers.map((watcher) => watcher.close()));
	g.__mediaLibraryWatchers = undefined;
}
