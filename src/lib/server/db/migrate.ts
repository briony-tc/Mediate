import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './index';

const g = globalThis as unknown as { __mediaLibraryMigrated?: boolean };

export function runMigrations() {
	if (g.__mediaLibraryMigrated) return;
	migrate(db, { migrationsFolder: 'drizzle' });
	g.__mediaLibraryMigrated = true;
}
