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
		...(event.completePath !== undefined ? { completePath: event.completePath } : {}),
		...(event.ripTitlesCompleted !== undefined
			? { ripTitlesCompleted: event.ripTitlesCompleted }
			: {}),
		...(event.ripTitlesTotal !== undefined ? { ripTitlesTotal: event.ripTitlesTotal } : {})
	};
	return next;
}

export function formatProgressLine(titlesCompleted: number, titlesTotal: number): string {
	if (titlesCompleted >= titlesTotal) return `All ${titlesTotal} titles ripped`;
	return `Ripping title ${titlesCompleted + 1} of ${titlesTotal}`;
}

const MAX_PROGRESS_LOG_ENTRIES = 20;

/**
 * Appends a "N of M" line to a disc's rolling progress log, only when the
 * event's title counts are actually new (not a duplicate/unrelated SSE
 * message) - compared against the disc's *pre-merge* state, so call this
 * before mergeEvent updates it. Capped so a long multi-title rip can't grow
 * this unbounded.
 */
export function appendProgressLog(
	log: Record<number, string[]>,
	discs: Disc[],
	event: StatusChangeEvent
): Record<number, string[]> {
	if (event.ripTitlesCompleted == null || event.ripTitlesTotal == null) return log;

	const current = discs.find((d) => d.id === event.discId);
	if (
		current &&
		current.ripTitlesCompleted === event.ripTitlesCompleted &&
		current.ripTitlesTotal === event.ripTitlesTotal
	) {
		return log;
	}

	const line = formatProgressLine(event.ripTitlesCompleted, event.ripTitlesTotal);
	const existing = log[event.discId] ?? [];
	return { ...log, [event.discId]: [...existing, line].slice(-MAX_PROGRESS_LOG_ENTRIES) };
}

/**
 * Instantiate one of these per page component (not as a shared module
 * singleton) - in adapter-node the server process is long-lived and a
 * module-level instance would be shared across every concurrent request.
 */
export class DiscStore {
	discs = $state<Disc[]>([]);
	progressLog = $state<Record<number, string[]>>({});

	/** Opens the live SSE connection. Call only from onMount (browser-only). */
	connect(): () => void {
		const source = new EventSource('/api/events');
		source.onmessage = (message) => {
			const event: StatusChangeEvent = JSON.parse(message.data);
			// Must run before mergeEvent - it compares against the disc's
			// pre-update values to detect a genuine change.
			this.progressLog = appendProgressLog(this.progressLog, this.discs, event);
			this.discs = mergeEvent(this.discs, event);
		};
		return () => source.close();
	}
}
