import { relative } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { serverEnv } from '../env';
import { onFileSeen, type Tree } from './reconcile';

/**
 * Only 'addDir' is watched, not 'add': the movies/<title>/*.mkv and
 * tv/<title>/<season>/*.mkv convention means individual files live one level
 * deeper than depth allows, so the title folder's own creation is the signal
 * we react to - matching happens at title granularity, not per-file.
 */
function watchTree(root: string, tree: Tree): FSWatcher {
	const watcher = watch(root, {
		depth: 2,
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
