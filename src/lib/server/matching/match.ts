import { distance } from 'fastest-levenshtein';
import { normalizeTitle } from './normalize';

/** Score >= this auto-links a filesystem entry to a disc. */
export const AUTO_MATCH_THRESHOLD = 0.85;
/** Score >= this (but below AUTO_MATCH_THRESHOLD) surfaces as a suggestion for manual review. */
export const SUGGEST_THRESHOLD = 0.5;

export function scoreMatch(a: string, b: string): number {
	const na = normalizeTitle(a);
	const nb = normalizeTitle(b);
	if (!na || !nb) return 0;
	if (na === nb) return 1;

	const maxLen = Math.max(na.length, nb.length);
	return 1 - distance(na, nb) / maxLen;
}

export type MatchCandidate = { id: number; title: string };

export function findBestDiscMatch<T extends MatchCandidate>(
	filename: string,
	candidates: T[]
): { disc: T; score: number } | null {
	let best: { disc: T; score: number } | null = null;
	for (const disc of candidates) {
		const score = scoreMatch(filename, disc.title);
		if (!best || score > best.score) {
			best = { disc, score };
		}
	}
	return best;
}
