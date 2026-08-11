<script lang="ts">
	let {
		checked = $bindable(false),
		disabled = false,
		label = 'Toggle',
		onCheckedChange
	}: {
		checked?: boolean;
		disabled?: boolean;
		/** Accessible label describing what the switch controls. */
		label?: string;
		onCheckedChange?: (v: boolean) => void;
	} = $props();

	function toggle() {
		if (disabled) return;
		checked = !checked;
		onCheckedChange?.(checked);
	}
</script>

<button
	type="button"
	role="switch"
	aria-label={label}
	aria-checked={checked}
	{disabled}
	onclick={toggle}
	class="relative inline-flex h-5.5 w-10 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ui-color-primary-500)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ui-bg)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 {checked
		? 'bg-[var(--ui-color-primary-500)]'
		: 'bg-[var(--ui-bg-accented)]'}"
>
	<span
		class="pointer-events-none block size-4.5 rounded-full bg-white shadow-lg ring-0 transition-transform {checked
			? 'translate-x-4.5 rtl:-translate-x-4.5'
			: 'translate-x-0.5'}"
	></span>
</button>
