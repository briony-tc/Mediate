import type { RequestHandler } from './$types';
import { subscribe } from '$lib/server/events';
import type { StatusChangeEvent } from '$lib/types';

const HEARTBEAT_INTERVAL_MS = 25_000;

export const GET: RequestHandler = () => {
	let unsubscribe: () => void;
	let heartbeat: ReturnType<typeof setInterval>;

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			const send = (event: StatusChangeEvent) => {
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
			};

			unsubscribe = subscribe(send);
			heartbeat = setInterval(() => {
				controller.enqueue(encoder.encode(':\n\n'));
			}, HEARTBEAT_INTERVAL_MS);
		},
		cancel() {
			unsubscribe?.();
			clearInterval(heartbeat);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
