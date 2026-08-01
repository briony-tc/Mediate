import { createDb } from './client';
import { serverEnv } from '../env';

const g = globalThis as unknown as { __mediaLibraryDb?: ReturnType<typeof createDb> };

if (!g.__mediaLibraryDb) {
	g.__mediaLibraryDb = createDb(serverEnv.DB_PATH);
}

export const db = g.__mediaLibraryDb;
