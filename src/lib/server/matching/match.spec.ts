import { describe, expect, it } from 'vitest';
import { AUTO_MATCH_THRESHOLD, SUGGEST_THRESHOLD, findBestDiscMatch, scoreMatch } from './match';

describe('scoreMatch', () => {
	it('scores identical titles as 1', () => {
		expect(scoreMatch('Inception', 'Inception')).toBe(1);
	});

	it('scores messy real-world UPC/folder titles above the auto-match threshold', () => {
		expect(scoreMatch('Inception (Widescreen Edition) [DVD]', 'Inception')).toBeGreaterThanOrEqual(
			AUTO_MATCH_THRESHOLD
		);
		expect(scoreMatch('The.Matrix.1999.DVD', 'The Matrix')).toBeGreaterThanOrEqual(
			SUGGEST_THRESHOLD
		);
	});

	it('does not auto-match near-miss sequel/prequel titles', () => {
		expect(scoreMatch('Inception 2', 'Inception')).toBeLessThan(AUTO_MATCH_THRESHOLD);
		expect(scoreMatch('Toy Story 2', 'Toy Story')).toBeLessThan(AUTO_MATCH_THRESHOLD);
		expect(scoreMatch('Paddington 2', 'Paddington')).toBeLessThan(AUTO_MATCH_THRESHOLD);
	});

	it('scores unrelated titles low', () => {
		expect(scoreMatch('Inception', 'The Godfather')).toBeLessThan(SUGGEST_THRESHOLD);
	});

	it('returns 0 for empty input', () => {
		expect(scoreMatch('', 'Inception')).toBe(0);
		expect(scoreMatch('   ', 'Inception')).toBe(0);
	});
});

describe('findBestDiscMatch', () => {
	const candidates = [
		{ id: 1, title: 'Inception' },
		{ id: 2, title: 'Inception 2' },
		{ id: 3, title: 'The Godfather' }
	];

	it('picks the closest candidate', () => {
		const result = findBestDiscMatch('Inception (Widescreen Edition) [DVD]', candidates);
		expect(result?.disc.id).toBe(1);
	});

	it('does not let a near-miss sequel steal the match from the exact title', () => {
		const result = findBestDiscMatch('Inception', candidates);
		expect(result?.disc.id).toBe(1);
		expect(result?.score).toBe(1);
	});

	it('returns null for an empty candidate list', () => {
		expect(findBestDiscMatch('Inception', [])).toBeNull();
	});
});
