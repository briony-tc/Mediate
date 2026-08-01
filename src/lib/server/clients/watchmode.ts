import { serverEnv } from '../env';

const BASE_URL = 'https://api.watchmode.com/v1';

export type WatchmodeSearchResult = {
	id: number;
	name: string;
	type: string;
	year?: number;
	imdbId?: string;
};

export type WatchmodeTitleDetails = {
	id: number;
	title: string;
	type: string;
	year?: number;
	imdbId?: string;
	genreNames: string[];
	posterUrl?: string;
};

type WatchmodeSearchResponse = {
	title_results?: {
		id: number;
		name: string;
		type: string;
		year?: number;
		imdb_id?: string;
	}[];
};

type WatchmodeTitleDetailsResponse = {
	id: number;
	title: string;
	type: string;
	year?: number;
	imdb_id?: string;
	genre_names?: string[];
	poster?: string;
};

/** Movie-adjacent Watchmode types collapse to 'movie'; everything else is 'tv'. */
export function toMediaType(watchmodeType: string): 'movie' | 'tv' {
	return watchmodeType === 'movie' || watchmodeType === 'short_film' ? 'movie' : 'tv';
}

export async function searchTitles(query: string): Promise<WatchmodeSearchResult[]> {
	const url = `${BASE_URL}/search/?apiKey=${encodeURIComponent(serverEnv.WATCHMODE_API_KEY)}&search_field=name&search_value=${encodeURIComponent(query)}`;

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Watchmode search failed with status ${response.status}`);
	}

	const data = (await response.json()) as WatchmodeSearchResponse;
	return (data.title_results ?? []).map((r) => ({
		id: r.id,
		name: r.name,
		type: r.type,
		year: r.year,
		imdbId: r.imdb_id
	}));
}

export async function getTitleDetails(watchmodeId: number): Promise<WatchmodeTitleDetails> {
	const url = `${BASE_URL}/title/${watchmodeId}/details/?apiKey=${encodeURIComponent(serverEnv.WATCHMODE_API_KEY)}`;

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Watchmode title details failed with status ${response.status}`);
	}

	const data = (await response.json()) as WatchmodeTitleDetailsResponse;
	return {
		id: data.id,
		title: data.title,
		type: data.type,
		year: data.year,
		imdbId: data.imdb_id,
		genreNames: data.genre_names ?? [],
		posterUrl: data.poster
	};
}
