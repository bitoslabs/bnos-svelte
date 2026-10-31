<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { tick, untrack } from 'svelte';
	import { cn } from '$lib/utils/cn';
	import Icon from './Icon.svelte';
	import {
		caretAfterNumericChars,
		clampNumeric,
		formatNumericValue,
		groupNumeric,
		numericCharCount,
		parseNumericInput,
		roundNumeric,
		sanitizeNumericInput
	} from '$lib/utils/number-input';

	/**
	 * Numeric text field with live thousands grouping, fraction limits and an
	 * optional prefix/suffix (currency symbol or code).
	 *
	 * Binds a real `number` — or `''` while the field is empty/partial — instead
	 * of the formatted string, so callers never parse the display value.
	 * `type="text"` + `inputmode="decimal"` keeps mobile keyboards numeric while
	 * leaving the caret fully under our control.
	 */
	let {
		value = $bindable<number | ''>(''),
		class: cls,
		size = 'md',
		align = 'right',
		decimals,
		maxDecimals = 2,
		min,
		max,
		step = 1,
		allowNegative = false,
		grouping = true,
		icon,
		prefix,
		suffix,
		placeholder,
		disabled = false,
		onblur,
		oninput,
		...rest
	}: {
		class?: string;
		value?: number | '';
		size?: 'sm' | 'md' | 'lg';
		/** Horizontal alignment of the digits. Amounts read best right-aligned
		 *  (the default); `center` suits short counters, `left` a leading symbol. */
		align?: 'left' | 'center' | 'right';
		/** Fixed fraction digits applied on blur, e.g. `2` for money. */
		decimals?: number;
		/** Maximum fraction digits accepted while typing. */
		maxDecimals?: number;
		min?: number;
		max?: number;
		/** Increment used by ArrowUp / ArrowDown (Shift multiplies it by 10). */
		step?: number;
		allowNegative?: boolean;
		grouping?: boolean;
		/** Leading icon, matching `Input`'s `icon` prop. */
		icon?: string;
		/** Text before the digits, e.g. a currency symbol. */
		prefix?: string;
		/** Text after the digits, e.g. a currency code. */
		suffix?: string;
		placeholder?: string;
		disabled?: boolean;
		onblur?: (event: FocusEvent) => void;
		oninput?: (event: Event) => void;
	} & Omit<
		HTMLInputAttributes,
		| 'value'
		| 'size'
		| 'min'
		| 'max'
		| 'step'
		| 'prefix'
		| 'type'
		| 'inputmode'
		| 'oninput'
		| 'onblur'
		| 'onkeydown'
		| 'icon'
	> = $props();

	const height = $derived(
		size === 'sm' ? 'h-8 px-2.5' : size === 'lg' ? 'h-11 px-4' : 'h-9.5 px-3'
	);

	let display = $state(untrack(() => formatNumericValue(value, { decimals, grouping })));

	// External writes (form reset, edit dialog) update the field. Comparing the
	// parsed display keeps live typing stable: `1,234.` already parses to 1234.
	$effect(() => {
		const bound = value;
		if (parseNumericInput(display) === bound) return;
		const next = formatNumericValue(bound, { decimals, grouping });
		if (next !== display) display = next;
	});

	async function handleInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const raw = input.value;
		const caret = input.selectionStart ?? raw.length;
		const significant = numericCharCount(raw.slice(0, caret));

		const sanitized = sanitizeNumericInput(raw, { allowNegative, maxDecimals });
		display = groupNumeric(sanitized, grouping);
		value = parseNumericInput(display);
		oninput?.(event);

		// Formatting may have inserted separators; restore the logical caret
		// position once Svelte has written the new value.
		await tick();
		const position = caretAfterNumericChars(display, significant);
		input.setSelectionRange(position, position);
	}

	function handleBlur(event: FocusEvent) {
		const parsed = parseNumericInput(display);
		if (parsed === '') {
			display = '';
			value = '';
		} else {
			const clamped = clampNumeric(
				decimals === undefined ? parsed : roundNumeric(parsed, decimals),
				min,
				max
			);
			value = clamped;
			display = formatNumericValue(clamped, { decimals, grouping });
		}
		onblur?.(event);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		const direction = event.key === 'ArrowUp' ? 1 : -1;
		const current = parseNumericInput(display);
		const base = current === '' ? (min ?? 0) : current;
		const delta = step * (event.shiftKey ? 10 : 1) * direction;
		const next = clampNumeric(roundNumeric(base + delta, maxDecimals), min, max);
		value = next;
		display = formatNumericValue(next, { decimals, grouping });
	}
</script>

<div
	class={cn(
		'focus-ring-field inline-flex items-center gap-2 rounded-lg border border-(--ui-border) bg-(--ui-bg-muted) transition-colors',
		height,
		disabled ? 'opacity-60' : 'hover:border-(--ui-border-accented)',
		cls
	)}
>
	{#if icon}<Icon name={icon} class="size-4 shrink-0 text-(--ui-text-dimmed)" />{/if}
	{#if prefix}<span class="shrink-0 text-[13px] font-medium text-(--ui-text-dimmed)">{prefix}</span
		>{/if}
	<input
		{...rest}
		value={display}
		{placeholder}
		{disabled}
		type="text"
		inputmode="decimal"
		autocomplete="off"
		oninput={handleInput}
		onblur={handleBlur}
		onkeydown={handleKeydown}
		class={cn(
			'min-w-0 flex-1 bg-transparent text-[13.5px] text-(--ui-text) tabular-nums placeholder:text-(--ui-text-dimmed) focus:outline-none',
			align === 'right' && 'text-right',
			align === 'center' && 'text-center',
			align === 'left' && 'text-left'
		)}
	/>
	{#if suffix}<span class="shrink-0 text-[11px] font-semibold tracking-wide text-(--ui-text-dimmed)"
			>{suffix}</span
		>{/if}
</div>
