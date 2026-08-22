import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';

export const discs = sqliteTable('discs', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	// ripping: actively being ripped (staging folder created, not yet confirmed
	// done). staged: rip confirmed done but auto-filing into Jellyfin didn't
	// happen cleanly (ambiguous match, or promotion failed) - needs a look.
	status: text('status', { enum: ['not_started', 'ripping', 'staged', 'complete'] })
		.notNull()
		.default('not_started'),
	// 'owned' (default) covers every disc that came through the physical rip
	// pipeline - scanning a barcode or ripping a disc is itself proof of
	// possession (see reconcile.ts's applyStatusTransition, which flips a
	// 'wanted' row to 'owned' the moment its staging folder appears). 'wanted'
	// is a wishlist entry with no disc yet. 'digital_only' is content already
	// filed into Jellyfin (usually linked from an existing unmatchedFiles
	// entry) that was never physically owned - e.g. acquired from the
	// internet - so losing the Jellyfin file would mean losing it for good.
	ownership: text('ownership', { enum: ['owned', 'wanted', 'digital_only'] })
		.notNull()
		.default('owned'),
	title: text('title').notNull(),
	mediaType: text('media_type', { enum: ['movie', 'tv'] }).notNull(),
	// TV seasons are sold/barcoded individually but share one Watchmode title
	// (the series), so watchmodeId alone can't be unique - (watchmodeId,
	// season) identifies a row; null season means "movie" or "whole series".
	season: integer('season'),
	// Set when this disc is one of several covering the same (watchmodeId,
	// season) - e.g. a film split across 2 DVDs, or a TV season sold across
	// multiple discs. Null means "single disc" (the default, and still the
	// overwhelming majority of titles) - promoteToJellyfin branches on this to
	// avoid discs of the same title overwriting each other on file.
	discNumber: integer('disc_number'),
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
	// How many titles of the multi-title rip are done vs. total, reported by
	// the auto-rip script at each loop boundary (not a live in-title percent -
	// MakeMKV's own progress output isn't reliably readable, confirmed live -
	// this is a coarser but fully reliable signal instead). Null before the
	// first report arrives, or once the disc leaves 'ripping'.
	ripTitlesCompleted: integer('rip_titles_completed'),
	ripTitlesTotal: integer('rip_titles_total'),
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

export const pipelineEvents = sqliteTable('pipeline_events', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	// Closed enum (like scanEvents.outcome) so the UI can render a fixed set
	// of known labels instead of guessing at arbitrary strings. Only add a
	// new kind when a *new* console.warn-worthy site is promoted to a
	// persisted event - see rip-complete/+server.ts's needs_review fallback,
	// watcher.ts's two misconfiguration warnings, and promote.ts's
	// tv_bonus_content_excluded (a ripped title held back from episode
	// numbering for looking like bonus content, not a real episode).
	kind: text('kind', {
		enum: [
			'rip_needs_review',
			'staging_path_misconfigured',
			'jellyfin_path_misconfigured',
			'tv_bonus_content_excluded'
		]
	}).notNull(),
	message: text('message').notNull(),
	createdAt: integer('created_at')
		.notNull()
		.$defaultFn(() => Date.now()),
	// Soft-dismiss (mirrors unmatchedFiles.resolution) rather than a hard
	// delete - keeps a short audit trail instead of losing the record the
	// moment someone clicks past it. No discId column: every event kind
	// captured so far is definitionally not resolvable to one disc (that's
	// the whole problem with rip_needs_review, and the misconfiguration
	// warnings are boot-time, disc-less).
	dismissedAt: integer('dismissed_at')
});

export type Disc = typeof discs.$inferSelect;
export type NewDisc = typeof discs.$inferInsert;
export type UnmatchedFile = typeof unmatchedFiles.$inferSelect;
export type NewUnmatchedFile = typeof unmatchedFiles.$inferInsert;
export type ScanEvent = typeof scanEvents.$inferSelect;
export type NewScanEvent = typeof scanEvents.$inferInsert;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
export type PipelineEvent = typeof pipelineEvents.$inferSelect;
export type NewPipelineEvent = typeof pipelineEvents.$inferInsert;
