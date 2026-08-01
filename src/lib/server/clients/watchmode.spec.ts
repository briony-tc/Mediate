import { afterEach, describe, expect, it, vi } from 'vitest';

const mockEnv: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const { getTitleDetails, searchTitles, toMediaType } = await import('./watchmode');

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
