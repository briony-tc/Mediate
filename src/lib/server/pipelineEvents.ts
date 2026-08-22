import { and, eq, isNull } from 'drizzle-orm';
import { db } from './db';
import { pipelineEvents } from './db/schema';
import type { PipelineEventKind } from '$lib/types';

/**
 * Fire-and-forget (mirrors push.ts's notifyAll shape) - a logging failure
 * must never break the actual request/boot path calling this. Deduped
 * against an already-undismissed row of the same kind, since boot-time
 * misconfiguration warnings would otherwise insert a fresh row on every
 * restart/deploy instead of just staying visible until someone deals with it.
 */
export function logPipelineEvent(kind: PipelineEventKind, message: string): void {
	try {
		const existing = db
			.select()
			.from(pipelineEvents)
			.where(and(eq(pipelineEvents.kind, kind), isNull(pipelineEvents.dismissedAt)))
			.get();
		if (existing) return;
		db.insert(pipelineEvents).values({ kind, message }).run();
	} catch (err) {
		console.error(`[pipelineEvents] failed to persist "${kind}" event:`, err);
	}
}
