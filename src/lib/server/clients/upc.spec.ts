import { afterEach, describe, expect, it, vi } from 'vitest';

const mockEnv: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const { lookupUpc, cleanUpcTitle } = await import('./upc');

afterEach(() => {
	vi.unstubAllGlobals();
	for (const key of Object.keys(mockEnv)) delete mockEnv[key];
});

describe('lookupUpc', () => {
	it('returns a cleaned title when the trial endpoint finds an item', async () => {
		mockEnv.UPCITEMDB_API_KEY = '';
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ code: 'OK', items: [{ title: 'Inception [DVD]' }] }), {
				status: 200
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await lookupUpc('883929127538');

		expect(result).toEqual({ title: 'Inception' });
		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining('api.upcitemdb.com/prod/trial/lookup'),
			expect.anything()
		);
	});

	it('uses the prod endpoint with a user_key header when an api key is configured', async () => {
		mockEnv.UPCITEMDB_API_KEY = 'test-key';
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ code: 'OK', items: [{ title: 'Some Title' }] }), {
				status: 200
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		await lookupUpc('123');

		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining('api.upcitemdb.com/prod/v1/lookup'),
			expect.objectContaining({ headers: { user_key: 'test-key', key_type: '3scale' } })
		);
	});

	it('returns null when no items are found', async () => {
		mockEnv.UPCITEMDB_API_KEY = '';
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(new Response(JSON.stringify({ code: 'OK', items: [] }), { status: 200 }))
		);

		expect(await lookupUpc('000')).toBeNull();
	});

	it('throws on a non-ok response', async () => {
		mockEnv.UPCITEMDB_API_KEY = '';
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));

		await expect(lookupUpc('000')).rejects.toThrow();
	});
});

describe('cleanUpcTitle', () => {
	it('strips a barcode and trailing cast/crew names appended after it', () => {
		// real UPCitemdb response for EAN 5039036026956
		expect(
			cleanUpcTitle('Ferngully: The Magical Rescue [dvd], 5039036026956, Phil Robinson, Dave')
		).toBe('Ferngully: The Magical Rescue');
	});

	it('strips bracketed format noise', () => {
		expect(cleanUpcTitle('Inception [DVD]')).toBe('Inception');
	});

	it('leaves a plain title with no barcode/crew tail unchanged', () => {
		expect(cleanUpcTitle('The Matrix')).toBe('The Matrix');
	});
});
