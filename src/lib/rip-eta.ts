/**
 * Linear extrapolation from elapsed time + percent-complete - the same rough
 * approach MakeMKV's own GUI uses (it has no notion of "seconds left" either,
 * only a running percent). Returns null right at the start (no rate to
 * extrapolate from yet) or right at the tail (about to flip to complete) -
 * callers should fall back to a plain percent display in those cases.
 */
export function estimateSecondsRemaining(
	stagedAt: number,
	percent: number,
	now: number
): number | null {
	if (percent <= 0 || percent >= 100) return null;
	const elapsedMs = now - stagedAt;
	if (elapsedMs <= 0) return null;
	const totalEstimateMs = (elapsedMs / percent) * 100;
	return Math.round((totalEstimateMs - elapsedMs) / 1000);
}

export function formatRemaining(seconds: number): string {
	if (seconds < 60) return 'less than a minute remaining';
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `~${minutes} min remaining`;
	return `~${Math.floor(minutes / 60)}h ${minutes % 60}m remaining`;
}
