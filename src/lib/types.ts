export type DiscStatus = 'not_started' | 'staged' | 'complete';

export type Disc = {
	id: number;
	status: DiscStatus;
	title: string;
	mediaType: 'movie' | 'tv';
	season: number | null;
	year: number | null;
	watchmodeId: number;
	imdbId: string | null;
	posterUrl: string | null;
	genres: string | null;
	barcodeUpc: string | null;
	rawLookupTitle: string | null;
	stagedPath: string | null;
	completePath: string | null;
	stagedAt: number | null;
	completedAt: number | null;
	createdAt: number;
	updatedAt: number;
};

export type StatusChangeEvent = {
	discId: number;
	status: DiscStatus;
	stagedPath?: string | null;
	completePath?: string | null;
	updatedAt: number;
};
