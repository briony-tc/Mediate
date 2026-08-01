const BRACKETED = [/\[[^\]]*\]/g, /\([^)]*\)/g];

const NOISE_WORDS =
	/\b(widescreen|fullscreen|full screen|dvd|blu-?ray|edition|disc\s*\d+|disk\s*\d+|remastered|unrated|extended|director'?s cut|special edition|collector'?s edition|theatrical|anniversary|season\s*\d+)\b/gi;

export function normalizeTitle(raw: string): string {
	let s = raw.replace(/[‘’]/g, "'");
	for (const pattern of BRACKETED) {
		s = s.replace(pattern, ' ');
	}
	s = s.replace(NOISE_WORDS, ' ');
	s = s.toLowerCase();
	s = s.replace(/[^a-z0-9\s]/g, ' ');
	s = s.replace(/\s+/g, ' ').trim();
	return s;
}
