import { runMigrations } from '$lib/server/db/migrate';
import { startWatcher } from '$lib/server/watcher/watcher';

runMigrations();
startWatcher();

export const handle = async ({ event, resolve }) => resolve(event);
