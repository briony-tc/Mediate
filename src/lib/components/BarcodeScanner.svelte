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
		// Deferred: at the moment `blur` fires, the browser hasn't finished
		// moving focus to whatever was just clicked, so checking
		// activeElement synchronously here would see it too early (or not at
		// all) and steal focus back before the click's own focus lands.
		setTimeout(() => {
			if (document.activeElement === document.body) {
				inputEl?.focus();
			}
		}, 0);
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
