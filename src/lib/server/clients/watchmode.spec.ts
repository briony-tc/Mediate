import { afterEach, describe, expect, it, vi } from 'vitest';

const mockEnv: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const { getTitleDetails, searchTitles, searchTitlesWithFallback, toMediaType } =
	await import('./watchmode');

afterEach(() => {
	vi.unstubAllGlobals();
	for (const key of Object.keys(mockEnv)) delete mockEnv[key];
});

describe('toMediaType', () => {
	it('maps movie types', () => {
		expect(toMediaType('movie')).toBe('movie');
		expect(toMediaType('short_film')).toBe('movie');
	});

	it('maps everything else to tv', () => {
		expect(toMediaType('tv_series')).toBe('tv');
		expect(toMediaType('tv_miniseries')).toBe('tv');
	});
});

describe('searchTitles', () => {
	it('maps title_results into WatchmodeSearchResult[]', async () => {
		mockEnv.WATCHMODE_API_KEY = 'test-key';
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						title_results: [
							{ id: 1, name: 'Inception', type: 'movie', year: 2010, imdb_id: 'tt1375666' }
						]
					}),
					{ status: 200 }
				)
			)
		);

		const results = await searchTitles('Inception');

		expect(results).toEqual([
			{ id: 1, name: 'Inception', type: 'movie', year: 2010, imdbId: 'tt1375666' }
		]);
	});

	it('returns an empty array when there are no results', async () => {
		mockEnv.WATCHMODE_API_KEY = 'test-key';
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(new Response(JSON.stringify({ title_results: [] }), { status: 200 }))
		);

		expect(await searchTitles('nonexistent')).toEqual([]);
	});

	it('throws on a non-ok response', async () => {
		mockEnv.WATCHMODE_API_KEY = 'test-key';
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));

		await expect(searchTitles('x')).rejects.toThrow();
	});
});

describe('searchTitlesWithFallback', () => {
	it('returns first-attempt results without retrying when the full title matches', async () => {
		mockEnv.WATCHMODE_API_KEY = 'test-key';
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ title_results: [{ id: 1, name: 'Inception', type: 'movie' }] }),
					{ status: 200 }
				)
			);
		vi.stubGlobal('fetch', fetchMock);

		const results = await searchTitlesWithFallback('Inception');

		expect(results).toHaveLength(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('retries with progressively shorter word-prefixes until something matches (real FernGully case)', async () => {
		mockEnv.WATCHMODE_API_KEY = 'test-key';
		const fetchMock = vi.fn(async (url: string) => {
			const query = new URL(url).searchParams.get('search_value');
			const matches = query === 'Ferngully';
			return new Response(
				JSON.stringify({
					title_results: matches
						? [{ id: 1661363, name: 'FernGully 2: The Magical Rescue', type: 'movie', year: 1998 }]
						: []
				}),
				{ status: 200 }
			);
		});
		vi.stubGlobal('fetch', fetchMock);

		const results = await searchTitlesWithFallback('Ferngully: The Magical Rescue');

		expect(results).toEqual([
			{
				id: 1661363,
				name: 'FernGully 2: The Magical Rescue',
				type: 'movie',
				year: 1998,
				imdbId: undefined
			}
		]);
		// "Ferngully The Magical Rescue" -> "Ferngully The Magical" -> "Ferngully The" -> "Ferngully"
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it('returns an empty array when nothing matches at any prefix length', async () => {
		mockEnv.WATCHMODE_API_KEY = 'test-key';
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockImplementation(
					async () => new Response(JSON.stringify({ title_results: [] }), { status: 200 })
				)
		);

		expect(await searchTitlesWithFallback('Completely Unknown Title')).toEqual([]);
	});
});

describe('getTitleDetails', () => {
	it('maps the details response', async () => {
		mockEnv.WATCHMODE_API_KEY = 'test-key';
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						id: 1,
						title: 'Inception',
						type: 'movie',
						year: 2010,
						imdb_id: 'tt1375666',
						genre_names: ['Action', 'Sci-Fi'],
						poster: 'https://example.com/poster.jpg'
					}),
					{ status: 200 }
				)
			)
		);

		const details = await getTitleDetails(1);

		expect(details).toEqual({
			id: 1,
			title: 'Inception',
			type: 'movie',
			year: 2010,
			imdbId: 'tt1375666',
			genreNames: ['Action', 'Sci-Fi'],
			posterUrl: 'https://example.com/poster.jpg'
		});
	});
});
