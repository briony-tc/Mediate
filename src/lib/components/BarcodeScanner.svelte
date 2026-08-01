<script lang="ts">
	let { onScan, focusSignal = 0 }: { onScan: (barcode: string) => void; focusSignal?: number } =
		$props();

	let value = $state('');
	let inputEl: HTMLInputElement | undefined;

	$effect(() => {
		focusSignal;
		inputEl?.focus();
	});

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
		const barcode = value.trim();
		value = '';
		if (barcode.length >= 4) {
			onScan(barcode);
		}
	}

	function refocusIfNothingElseFocused() {
		if (document.activeElement === document.body) {
			inputEl?.focus();
		}
	}
</script>

<input
	bind:this={inputEl}
	bind:value
	type="text"
	class="sr-only"
	tabindex="-1"
	aria-hidden="true"
	autocomplete="off"
	data-testid="barcode-scanner-input"
	onkeydown={handleKeydown}
	onblur={refocusIfNothingElseFocused}
/>
