export type DiscStatus = 'not_started' | 'ripping' | 'staged' | 'complete';
export type Ownership = 'owned' | 'wanted' | 'digital_only';

export type Disc = {
	id: number;
	status: DiscStatus;
	ownership: Ownership;
	title: string;
	mediaType: 'movie' | 'tv';
	season: number | null;
	discNumber: number | null;
	year: number | null;
	watchmodeId: number;
	imdbId: string | null;
	posterUrl: string | null;
	genres: string | null;
	barcodeUpc: string | null;
	rawLookupTitle: string | null;
	armedAt: number | null;
	ripTitlesCompleted: number | null;
	ripTitlesTotal: number | null;
	stagedPath: string | null;
	completePath: string | null;
	stagedAt: number | null;
	completedAt: number | null;
	createdAt: number;
	updatedAt: number;
};

export type PipelineEventKind =
	| 'rip_needs_review'
	| 'staging_path_misconfigured'
	| 'jellyfin_path_misconfigured'
	| 'tv_bonus_content_excluded';

export type PipelineEvent = {
	id: number;
	kind: PipelineEventKind;
	message: string;
	createdAt: number;
	dismissedAt: number | null;
};

export type StatusChangeEvent = {
	discId: number;
	status: DiscStatus;
	stagedPath?: string | null;
	completePath?: string | null;
	ripTitlesCompleted?: number | null;
	ripTitlesTotal?: number | null;
	updatedAt: number;
};
