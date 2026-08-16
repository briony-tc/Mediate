/**
 * One disc scanned during a logged scan session - a batch of confirmed
 * candidates worth exporting as a report (e.g. cataloging a stack of discs
 * before deciding what to keep). `alreadyOwned` reflects whether
 * /api/confirm 409'd (you already track this title/season) rather than
 * created a new disc.
 */
export type ScanSessionEntry = {
	title: string;
	year: number | null;
	mediaType: 'movie' | 'tv';
	season: number | null;
	discNumber: number | null;
	genres: string | null;
	barcodeUpc: string | null;
	alreadyOwned: boolean;
};

const CSV_HEADER = [
	'Title',
	'Year',
	'Type',
	'Season',
	'Disc',
	'Genres',
	'Barcode',
	'Already in your collection'
];

function escapeCsvField(value: string): string {
	if (/[",\n]/.test(value)) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

function parseGenres(genres: string | null): string {
	if (!genres) return '';
	try {
		const names = JSON.parse(genres);
		return Array.isArray(names) ? names.filter((n) => typeof n === 'string').join('; ') : '';
	} catch {
		return '';
	}
}

export function sessionEntriesToCsv(entries: ScanSessionEntry[]): string {
	const rows = entries.map((entry) =>
		[
			entry.title,
			entry.year?.toString() ?? '',
			entry.mediaType === 'tv' ? 'TV' : 'Movie',
			entry.season?.toString() ?? '',
			entry.discNumber?.toString() ?? '',
			parseGenres(entry.genres),
			entry.barcodeUpc ?? '',
			entry.alreadyOwned ? 'Yes' : 'No'
		].map(escapeCsvField)
	);
	return [CSV_HEADER, ...rows].map((row) => row.join(',')).join('\r\n');
}
