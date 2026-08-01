import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export function createDb(path: string) {
	if (path !== ':memory:') {
		mkdirSync(dirname(path), { recursive: true });
	}
	const sqlite = new Database(path);
	sqlite.pragma('journal_mode = WAL');
	return drizzle(sqlite, { schema });
}
