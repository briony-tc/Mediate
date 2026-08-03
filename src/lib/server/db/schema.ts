import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';

export const discs = sqliteTable('discs', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	// ripping: actively being ripped (staging folder created, not yet confirmed
	// done). staged: rip confirmed done but auto-filing into Jellyfin didn't
	// happen cleanly (ambiguous match, or promotion failed) - needs a look.
	status: text('status', { enum: ['not_started', 'ripping', 'staged', 'complete'] })
		.notNull()
		.default('not_started'),
	title: text('title').notNull(),
	mediaType: text('media_type', { enum: ['movie', 'tv'] }).notNull(),
	// TV seasons are sold/barcoded individually but share one Watchmode title
	// (the series), so watchmodeId alone can't be unique - (watchmodeId,
	// season) identifies a row; null season means "movie" or "whole series".
	season: integer('season'),
	year: integer('year'),
	watchmodeId: integer('watchmode_id').notNull(),
	imdbId: text('imdb_id'),
	posterUrl: text('poster_url'),
	genres: text('genres'),
	barcodeUpc: text('barcode_upc'),
	rawLookupTitle: text('raw_lookup_title'),
	// Set when the user picks this disc in the UI as "the one I'm about to
	// insert" - lets the watcher link the next staging folder to it
	// unconditionally instead of fuzzy-matching by folder name. Cleared the
	// moment it actually transitions to 'ripping'. Null the rest of the time.
	armedAt: integer('armed_at'),
	// Latest known percent-complete (0-100) reported by the auto-rip script
	// while status is 'ripping', via /api/rip-progress. Null before the first
	// report arrives, or once the disc leaves 'ripping'.
	ripProgressPercent: integer('rip_progress_percent'),
	stagedPath: text('staged_path'),
	completePath: text('complete_path'),
	stagedAt: integer('staged_at'),
	completedAt: integer('completed_at'),
	createdAt: integer('created_at')
		.notNull()
		.$defaultFn(() => Date.now()),
	updatedAt: integer('updated_at')
		.notNull()
		.$defaultFn(() => Date.now())
});

export const unmatchedFiles = sqliteTable('unmatched_files', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	path: text('path').notNull().unique(),
	tree: text('tree', { enum: ['staging', 'jellyfin'] }).notNull(),
	detectedAt: integer('detected_at')
		.notNull()
		.$defaultFn(() => Date.now()),
	bestGuessDiscId: integer('best_guess_disc_id').references(() => discs.id),
	bestGuessScore: real('best_guess_score'),
	resolution: text('resolution', { enum: ['unresolved', 'linked', 'ignored'] })
		.notNull()
		.default('unresolved')
});

export const scanEvents = sqliteTable('scan_events', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	barcode: text('barcode'),
	upcTitle: text('upc_title'),
	watchmodeId: integer('watchmode_id'),
	outcome: text('outcome', {
		enum: ['linked', 'no_upc_match', 'no_watchmode_match', 'ambiguous', 'manual_search']
	}).notNull(),
	createdAt: integer('created_at')
		.notNull()
		.$defaultFn(() => Date.now())
});

export const pushSubscriptions = sqliteTable('push_subscriptions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	endpoint: text('endpoint').notNull().unique(),
	p256dh: text('p256dh').notNull(),
	auth: text('auth').notNull(),
	createdAt: integer('created_at')
		.notNull()
		.$defaultFn(() => Date.now())
});

export type Disc = typeof discs.$inferSelect;
export type NewDisc = typeof discs.$inferInsert;
export type UnmatchedFile = typeof unmatchedFiles.$inferSelect;
export type NewUnmatchedFile = typeof unmatchedFiles.$inferInsert;
export type ScanEvent = typeof scanEvents.$inferSelect;
export type NewScanEvent = typeof scanEvents.$inferInsert;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
