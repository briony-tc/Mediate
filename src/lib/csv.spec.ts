import { describe, expect, it } from 'vitest';
import { sessionEntriesToCsv, type ScanSessionEntry } from './csv';

function makeEntry(overrides: Partial<ScanSessionEntry> = {}): ScanSessionEntry {
	return {
		title: 'Inception',
		year: 2010,
		mediaType: 'movie',
		season: null,
		discNumber: null,
		genres: null,
		barcodeUpc: null,
		alreadyOwned: false,
		...overrides
	};
}

describe('sessionEntriesToCsv', () => {
	it('writes a header row even with no entries', () => {
		expect(sessionEntriesToCsv([])).toBe(
			'Title,Year,Type,Season,Disc,Genres,Barcode,Already in your collection'
		);
	});

	it('writes a data row with basic fields', () => {
		const csv = sessionEntriesToCsv([makeEntry()]);
		const lines = csv.split('\r\n');
		expect(lines[1]).toBe('Inception,2010,Movie,,,,,No');
	});

	it('marks already-owned entries', () => {
		const csv = sessionEntriesToCsv([makeEntry({ alreadyOwned: true })]);
		expect(csv.split('\r\n')[1].endsWith(',Yes')).toBe(true);
	});

	it('includes season, disc number, and type for TV', () => {
		const csv = sessionEntriesToCsv([
			makeEntry({ mediaType: 'tv', season: 2, discNumber: 3, title: 'The Vicar of Dibley' })
		]);
		expect(csv.split('\r\n')[1]).toBe('The Vicar of Dibley,2010,TV,2,3,,,No');
	});

	it('parses the genres JSON array into a semicolon-joined list', () => {
		const csv = sessionEntriesToCsv([
			makeEntry({ genres: JSON.stringify(['Action', 'Sci-Fi']) })
		]);
		expect(csv.split('\r\n')[1]).toBe('Inception,2010,Movie,,,Action; Sci-Fi,,No');
	});

	it('falls back to an empty genres field on malformed JSON', () => {
		const csv = sessionEntriesToCsv([makeEntry({ genres: 'not json' })]);
		expect(csv.split('\r\n')[1]).toBe('Inception,2010,Movie,,,,,No');
	});

	it('quotes and escapes fields containing commas or quotes', () => {
		const csv = sessionEntriesToCsv([makeEntry({ title: 'Alvin and the Chipmunks: "The Squeakquel"' })]);
		expect(csv.split('\r\n')[1]).toBe(
			'"Alvin and the Chipmunks: ""The Squeakquel""",2010,Movie,,,,,No'
		);
	});

	it('quotes fields containing newlines', () => {
		const csv = sessionEntriesToCsv([makeEntry({ barcodeUpc: 'line1\nline2' })]);
		expect(csv.split('\r\n')[1]).toBe('Inception,2010,Movie,,,,"line1\nline2",No');
	});
});
