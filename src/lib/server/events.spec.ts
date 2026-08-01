import { describe, expect, it } from 'vitest';
import { emit, subscribe, type StatusChangeEvent } from './events';

describe('events pub/sub', () => {
	it('delivers emitted events to subscribers', () => {
		const received: StatusChangeEvent[] = [];
		const unsubscribe = subscribe((event) => received.push(event));

		const event: StatusChangeEvent = { discId: 1, status: 'staged', updatedAt: 123 };
		emit(event);

		expect(received).toEqual([event]);
		unsubscribe();
	});

	it('stops delivering events after unsubscribe', () => {
		const received: StatusChangeEvent[] = [];
		const unsubscribe = subscribe((event) => received.push(event));
		unsubscribe();

		emit({ discId: 1, status: 'complete', updatedAt: 456 });

		expect(received).toHaveLength(0);
	});

	it('delivers to multiple independent subscribers', () => {
		const a: StatusChangeEvent[] = [];
		const b: StatusChangeEvent[] = [];
		const unsubA = subscribe((event) => a.push(event));
		const unsubB = subscribe((event) => b.push(event));

		emit({ discId: 2, status: 'not_started', updatedAt: 1 });

		expect(a).toHaveLength(1);
		expect(b).toHaveLength(1);
		unsubA();
		unsubB();
	});
});
