const STORAGE_KEY = 'theme';

export function isDark(): boolean {
	return document.documentElement.classList.contains('dark');
}

// Keeps the theme-color meta tag (Chrome uses it to tint the Android status
// bar / gesture-nav bar, including inside the TWA) in sync with the actual
// theme - matches body's bg-white/dark:bg-gray-900 in layout.css.
function setThemeColorMeta(dark: boolean): void {
	document
		.querySelector('meta[name="theme-color"]')
		?.setAttribute('content', dark ? '#111827' : '#ffffff');
}

// Mirrors the inline script in app.html that sets the initial class (and
// theme-color meta) before first paint - this just needs to agree with it,
// not duplicate the no-flash trick, since by the time Svelte code runs both
// are already set.
export function initTheme(): void {
	const stored = localStorage.getItem(STORAGE_KEY);
	const dark = stored ? stored === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
	document.documentElement.classList.toggle('dark', dark);
	setThemeColorMeta(dark);
}

export function toggleTheme(): boolean {
	const dark = !isDark();
	document.documentElement.classList.toggle('dark', dark);
	setThemeColorMeta(dark);
	localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
	return dark;
}
