import { relative } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { serverEnv } from '../env';
import { onFileSeen, type Tree } from './reconcile';

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
