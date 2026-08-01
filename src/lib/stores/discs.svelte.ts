import type { Disc, StatusChangeEvent } from '$lib/types';

/** Patches the matching disc in place; unknown discIds (e.g. a scan from
 * another tab) are ignored rather than fabricated from a partial event. */
export function mergeEvent(discs: Disc[], event: StatusChangeEvent): Disc[] {
	const index = discs.findIndex((d) => d.id === event.discId);
	if (index === -1) return discs;

	const next = discs.slice();
	next[index] = {
		...next[index],
		status: event.status,
		updatedAt: event.updatedAt,
		...(event.stagedPath !== undefined ? { stagedPath: event.stagedPath } : {}),
		...(event.completePath !== undefined ? { completePath: event.completePath } : {})
	};
	return next;
}

/**
 * Instantiate one of these per page component (not as a shared module
 * singleton) - in adapter-node the server process is long-lived and a
 * module-level instance would be shared across every concurrent request.
 */
export class DiscStore {
	discs = $state<Disc[]>([]);

	/** Opens the live SSE connection. Call only from onMount (browser-only). */
	connect(): () => void {
		const source = new EventSource('/api/events');
		source.onmessage = (message) => {
			const event: StatusChangeEvent = JSON.parse(message.data);
			this.discs = mergeEvent(this.discs, event);
		};
		return () => source.close();
	}
}
