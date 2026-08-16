const STORAGE_KEY = 'theme';

export function isDark(): boolean {
	return document.documentElement.classList.contains('dark');
}

// Mirrors the inline script in app.html that sets the initial class before
// first paint - this just needs to agree with it, not duplicate the
// no-flash trick, since by the time Svelte code runs the class is already set.
export function initTheme(): void {
	const stored = localStorage.getItem(STORAGE_KEY);
	const dark = stored ? stored === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
	document.documentElement.classList.toggle('dark', dark);
}

export function toggleTheme(): boolean {
	const dark = !isDark();
	document.documentElement.classList.toggle('dark', dark);
	localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
	return dark;
}
