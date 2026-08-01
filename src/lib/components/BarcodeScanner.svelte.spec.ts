import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import BarcodeScanner from './BarcodeScanner.svelte';

describe('BarcodeScanner.svelte', () => {
	it('calls onScan with the typed barcode when Enter is pressed', async () => {
		const onScan = vi.fn();
		render(BarcodeScanner, { onScan });

		const input = page.getByTestId('barcode-scanner-input');
		await input.fill('883929127538');
		await userEvent.keyboard('{Enter}');

		expect(onScan).toHaveBeenCalledWith('883929127538');
	});

	it('clears the input after Enter', async () => {
		render(BarcodeScanner, { onScan: vi.fn() });

		const input = page.getByTestId('barcode-scanner-input');
		await input.fill('883929127538');
		await userEvent.keyboard('{Enter}');

		await expect.element(input).toHaveValue('');
	});

	it('ignores Enter on a too-short value', async () => {
		const onScan = vi.fn();
		render(BarcodeScanner, { onScan });

		const input = page.getByTestId('barcode-scanner-input');
		await input.fill('12');
		await userEvent.keyboard('{Enter}');

		expect(onScan).not.toHaveBeenCalled();
	});

	it('autofocuses on mount', async () => {
		render(BarcodeScanner, { onScan: vi.fn() });

		const input = page.getByTestId('barcode-scanner-input');
		await expect.element(input).toHaveFocus();
	});
});
