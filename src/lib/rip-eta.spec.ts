import { describe, expect, it } from 'vitest';
import { estimateSecondsRemaining, formatRemaining } from './rip-eta';

describe('estimateSecondsRemaining', () => {
	it('extrapolates remaining time linearly from elapsed time and percent', () => {
		// 60s elapsed at 50% -> another 60s estimated
		expect(estimateSecondsRemaining(0, 50, 60_000)).toBe(60);
		// 30s elapsed at 25% -> 90s estimated remaining
		expect(estimateSecondsRemaining(0, 25, 30_000)).toBe(90);
	});

	it('returns null at 0% (no rate to extrapolate from yet)', () => {
		expect(estimateSecondsRemaining(0, 0, 30_000)).toBeNull();
	});

	it('returns null at 100% (about to flip to complete)', () => {
		expect(estimateSecondsRemaining(0, 100, 30_000)).toBeNull();
	});

	it('returns null when no time has actually elapsed yet', () => {
		expect(estimateSecondsRemaining(60_000, 10, 60_000)).toBeNull();
		expect(estimateSecondsRemaining(60_000, 10, 30_000)).toBeNull();
	});
});

describe('formatRemaining', () => {
	it('shows "less than a minute" under 60s', () => {
		expect(formatRemaining(0)).toBe('less than a minute remaining');
		expect(formatRemaining(59)).toBe('less than a minute remaining');
	});

	it('shows rounded minutes under an hour', () => {
		expect(formatRemaining(60)).toBe('~1 min remaining');
		expect(formatRemaining(90)).toBe('~2 min remaining');
	});

	it('shows hours and minutes at an hour or more', () => {
		expect(formatRemaining(3600)).toBe('~1h 0m remaining');
		expect(formatRemaining(3900)).toBe('~1h 5m remaining');
	});
});
