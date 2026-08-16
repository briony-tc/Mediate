import { describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from './client';
import { discs, unmatchedFiles, scanEvents } from './schema';

describe('db schema', () => {
	it('migrates and round-trips rows through discs, unmatchedFiles, scanEvents', () => {
		const db = createDb(':memory:');
		migrate(db, { migrationsFolder: 'drizzle' });

		const [disc] = db
			.insert(discs)
			.values({
				title: 'Inception',
				mediaType: 'movie',
				watchmodeId: 12345,
				barcodeUpc: '883929127538'
			})
			.returning()
			.all();

		expect(disc.status).toBe('not_started');
		expect(disc.ownership).toBe('owned');
		expect(disc.title).toBe('Inception');
		expect(disc.createdAt).toBeTypeOf('number');

		db.insert(unmatchedFiles)
			.values({
				path: '/media/staging/movies/Some Unknown Title',
				tree: 'staging',
				bestGuessDiscId: disc.id,
				bestGuessScore: 0.6
			})
			.run();

		db.insert(scanEvents)
			.values({
				barcode: '883929127538',
				upcTitle: 'Inception Widescreen Edition DVD',
				watchmodeId: 12345,
				outcome: 'linked'
			})
			.run();

		expect(db.select().from(discs).all()).toHaveLength(1);
		expect(db.select().from(unmatchedFiles).all()).toHaveLength(1);
		expect(db.select().from(scanEvents).all()).toHaveLength(1);
	});
});
