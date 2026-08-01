import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatusChangeEvent } from '$lib/types';

const unsubscribeSpy = vi.fn();
const subscribeMock = vi.fn((cb: (event: StatusChangeEvent) => void) => unsubscribeSpy);

vi.mock('$lib/server/events', () => ({
	subscribe: (cb: (event: StatusChangeEvent) => void) => subscribeMock(cb)
}));

const { GET } = await import('./+server');

afterEach(() => {
	vi.clearAllMocks();
});

describe('GET /api/events', () => {
	it('sets SSE headers', async () => {
		const response = await GET({} as Parameters<typeof GET>[0]);
		expect(response.headers.get('Content-Type')).toBe('text/event-stream');
		expect(response.headers.get('Cache-Control')).toBe('no-cache');
		await response.body?.cancel();
	});

	it('subscribes on start, streams events as data lines, and unsubscribes on cancel', async () => {
		const response = await GET({} as Parameters<typeof GET>[0]);
		const reader = response.body!.getReader();

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(subscribeMock).toHaveBeenCalledTimes(1);

		const send = subscribeMock.mock.calls[0][0];
		const event: StatusChangeEvent = { discId: 1, status: 'staged', updatedAt: 123 };
		send(event);

		const { value } = await reader.read();
		const text = new TextDecoder().decode(value);
		expect(text).toBe(`data: ${JSON.stringify(event)}\n\n`);

		await reader.cancel();
		expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
	});
});
