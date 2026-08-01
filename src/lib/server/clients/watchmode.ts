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

/**
 * Watchmode's search is closer to exact-match than fuzzy - a title that's
 * even slightly off from Watchmode's own name (missing a word, wrong
 * punctuation) can return zero results even though a shorter fragment of
 * the same title matches fine (e.g. a UPC title missing a sequel's "2").
 * Retries with progressively shorter word-prefixes until something matches.
 */
export async function searchTitlesWithFallback(title: string): Promise<WatchmodeSearchResult[]> {
	const tokens = title.split(/[^a-z0-9]+/i).filter(Boolean);

	for (let n = tokens.length; n >= 1; n--) {
		const results = await searchTitles(tokens.slice(0, n).join(' '));
		if (results.length > 0) return results;
	}

	return [];
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
