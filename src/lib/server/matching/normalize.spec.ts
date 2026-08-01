import { describe, expect, it } from 'vitest';
import { normalizeTitle } from './normalize';

describe('normalizeTitle', () => {
	it('lowercases and collapses whitespace', () => {
		expect(normalizeTitle('  Inception  ')).toBe('inception');
	});

	it('strips bracketed and parenthesized noise', () => {
		expect(normalizeTitle('Inception [DVD]')).toBe('inception');
		expect(normalizeTitle('Inception (Widescreen Edition)')).toBe('inception');
		expect(normalizeTitle('Inception (2010)')).toBe('inception');
	});

	it('strips edition/format noise words outside brackets', () => {
		expect(normalizeTitle('Inception Widescreen DVD')).toBe('inception');
		expect(normalizeTitle('Inception Special Edition Blu-ray')).toBe('inception');
		expect(normalizeTitle('Inception Director’s Cut')).toBe(
			normalizeTitle("Inception Director's Cut")
		);
	});

	it('strips punctuation', () => {
		expect(normalizeTitle("Ocean's Eleven: Collector's Edition")).toBe('ocean s eleven');
	});

	it('does not conflate different titles that merely share a word', () => {
		expect(normalizeTitle('Inception')).not.toBe(normalizeTitle('Inception 2'));
	});
});
