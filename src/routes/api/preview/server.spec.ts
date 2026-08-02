import { afterEach, describe, expect, it, vi } from 'vitest';

const getTitleDetails = vi.fn();
vi.mock('$lib/server/clients/watchmode', () => ({
	getTitleDetails: (...args: unknown[]) => getTitleDetails(...args)
}));

const { POST } = await import('./+server');

function makeRequest(body: unknown) {
	return { request: { json: async () => body } } as Parameters<typeof POST>[0];
}

afterEach(() => {
	vi.clearAllMocks();
});

describe('POST /api/preview', () => {
	it('returns 400 when watchmodeId is missing', async () => {
		const response = await POST(makeRequest({}));
		expect(response.status).toBe(400);
	});

	it('returns title details for a valid watchmodeId', async () => {
		getTitleDetails.mockResolvedValue({
			id: 42,
			title: 'A Star Is Born',
			type: 'movie',
			year: 2018,
			genreNames: ['Drama'],
			posterUrl: 'https://example.com/poster.jpg'
		});

		const response = await POST(makeRequest({ watchmodeId: 42 }));
		const data = await response.json();

		expect(getTitleDetails).toHaveBeenCalledWith(42);
		expect(data.details.posterUrl).toBe('https://example.com/poster.jpg');
	});
});
