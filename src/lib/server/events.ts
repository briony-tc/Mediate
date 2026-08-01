import type { StatusChangeEvent } from '$lib/types';

export type { StatusChangeEvent };

type Listener = (event: StatusChangeEvent) => void;

const listeners = new Set<Listener>();

export function emit(event: StatusChangeEvent) {
	for (const listener of listeners) {
		listener(event);
	}
}

export function subscribe(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
