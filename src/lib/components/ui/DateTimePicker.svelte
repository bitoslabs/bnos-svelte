<script lang="ts">
	/**
	 * DateTimePicker — a trigger + calendar panel (with an optional time field)
	 * that binds a `yyyy-mm-dd` or `yyyy-mm-ddTHH:mm` string.
	 *
	 * The panel renders in the browser's top layer (`popover="manual"`) so it is
	 * never clipped by a scrolling dialog or a transformed ancestor, and becomes
	 * a drag-free bottom sheet on phones. Values are handled as *local* calendar
	 * dates — see `$lib/utils/date-input`.
	 */
	import { tick } from 'svelte';
	import { browser } from '$app/environment';
	import { t, i18n, localeTag } from '$lib/i18n/i18n.svelte';
	import { cn } from '$lib/utils/cn';
	import {
		combineDateTimeInput,
		dateInputKey,
		parseDateInput,
		parseDateTimeInput,
		todayDateInput
	} from '$lib/utils/date-input';
	import Button from './Button.svelte';
	import Icon from './Icon.svelte';

	let {
		value = $bindable(''),
		mode = 'date',
		size = 'md',
		placeholder,
		id,
		disabled = false,
		clearable = true,
		min = '',
		max = '',
		align = 'start',
		weekStartsOn = 0,
		ariaLabel,
		class: cls
	}: {
		/** `yyyy-mm-dd`, or `yyyy-mm-ddTHH:mm` in `datetime` mode. */
		value?: string;
		mode?: 'date' | 'datetime';
		size?: 'sm' | 'md' | 'lg';
		placeholder?: string;
		id?: string;
		disabled?: boolean;
		clearable?: boolean;
		/** Earliest selectable day (`yyyy-mm-dd`). */
		min?: string;
		/** Latest selectable day (`yyyy-mm-dd`). */
		max?: string;
		align?: 'start' | 'end';
		/** 0 = Sunday, 1 = Monday. */
		weekStartsOn?: number;
		/** Accessible name for the trigger (overrides the visible value). */
		ariaLabel?: string;
		class?: string;
	} = $props();

	const panelId = $props.id();
	/** Fallback panel width until it can be measured (19rem content + 1.5rem padding). */
	const FALLBACK_PANEL_WIDTH = 328;

	const height = $derived(size === 'sm' ? 'h-8' : size === 'lg' ? 'h-11' : 'h-9.5');

	// ── Value ────────────────────────────────────────────────────────────────
	const parts = $derived(parseDateTimeInput(value));
	const selectedDate = $derived(parseDateInput(parts.date));
	const selectedKey = $derived(selectedDate ? dateInputKey(selectedDate) : '');
	const timeValue = $derived(parts.time || '00:00');

	const locale = $derived(localeTag[i18n.locale]);
	const monthFormatter = $derived(
		new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })
	);
	const weekdayFormatter = $derived(new Intl.DateTimeFormat(locale, { weekday: 'short' }));
	const shortDateFormatter = $derived(
		new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' })
	);
	const fullDateFormatter = $derived(new Intl.DateTimeFormat(locale, { dateStyle: 'full' }));

	const displayText = $derived(
		selectedDate
			? mode === 'datetime' && parts.time
				? `${shortDateFormatter.format(selectedDate)} · ${parts.time}`
				: shortDateFormatter.format(selectedDate)
			: ''
	);

	// Keep a caller-supplied label ("From", "Start") while still announcing the value.
	const accessibleName = $derived(
		ariaLabel ? (displayText ? `${ariaLabel}: ${displayText}` : ariaLabel) : undefined
	);

	// ── Panel state ──────────────────────────────────────────────────────────
	let open = $state(false);
	let viewYear = $state(new Date().getFullYear());
	let viewMonth = $state(new Date().getMonth());

	let wrapperEl = $state<HTMLElement>();
	let triggerEl = $state<HTMLButtonElement>();
	let panelEl = $state<HTMLElement>();
	let sheetEl = $state<HTMLElement>();
	let position = $state({ top: 0, left: 0 });
	let isMobile = $state(false);

	const todayKey = $derived(todayDateInput());
	const monthLabel = $derived(monthFormatter.format(new Date(viewYear, viewMonth, 1)));

	const weekdayLabels = $derived.by(() =>
		Array.from({ length: 7 }, (_, index) =>
			weekdayFormatter.format(new Date(2024, 0, 7 + weekStartsOn + index))
		)
	);

	const cells = $derived.by(() => {
		const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
		const offset = (firstWeekday - weekStartsOn + 7) % 7;
		return Array.from({ length: 42 }, (_, index) => {
			const date = new Date(viewYear, viewMonth, 1 - offset + index);
			const key = dateInputKey(date);
			return {
				key,
				day: date.getDate(),
				label: fullDateFormatter.format(date),
				outside: date.getMonth() !== viewMonth,
				disabled: (min !== '' && key < min) || (max !== '' && key > max)
			};
		});
	});

	const weeks = $derived(
		Array.from({ length: 6 }, (_, index) => cells.slice(index * 7, index * 7 + 7))
	);

	/** Single tabbable day: the selection, else today, else the first day of the month. */
	const focusKey = $derived.by(() => {
		if (selectedKey && cells.some((cell) => cell.key === selectedKey)) return selectedKey;
		if (cells.some((cell) => cell.key === todayKey && !cell.outside && !cell.disabled)) {
			return todayKey;
		}
		return cells.find((cell) => !cell.outside && !cell.disabled)?.key ?? '';
	});

	function shiftMonth(delta: number, focusDay?: number) {
		const next = new Date(viewYear, viewMonth + delta, 1);
		viewYear = next.getFullYear();
		viewMonth = next.getMonth();
		if (focusDay !== undefined) {
			const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
			const key = dateInputKey(new Date(viewYear, viewMonth, Math.min(focusDay, lastDay)));
			void tick().then(() => focusDayButton(key));
		}
	}

	function focusDayButton(key: string) {
		if (!key) return;
		const root = panelEl ?? sheetEl;
		root?.querySelector<HTMLElement>(`[data-date="${key}"]`)?.focus();
	}

	function syncViewToSelection() {
		const base = selectedDate ?? new Date();
		viewYear = base.getFullYear();
		viewMonth = base.getMonth();
	}

	async function openPanel() {
		if (disabled) return;
		syncViewToSelection();
		open = true;
		await tick();
		focusDayButton(focusKey);
	}

	function close(restoreFocus = false) {
		open = false;
		if (restoreFocus) triggerEl?.focus();
	}

	function toggle() {
		if (open) close();
		else void openPanel();
	}

	function selectDay(key: string) {
		if (mode === 'date') {
			value = key;
			close(true);
			return;
		}
		const date = parseDateInput(key);
		if (date) {
			viewYear = date.getFullYear();
			viewMonth = date.getMonth();
		}
		value = combineDateTimeInput(key, parts.time);
	}

	function goToday() {
		const key = todayDateInput();
		const today = parseDateInput(key);
		if (today) {
			viewYear = today.getFullYear();
			viewMonth = today.getMonth();
		}
		if (mode === 'date') {
			value = key;
			close(true);
		} else {
			value = combineDateTimeInput(key, parts.time);
		}
	}

	function setTime(time: string) {
		value = combineDateTimeInput(selectedKey || todayDateInput(), time);
	}

	function clearValue() {
		value = '';
		close(true);
	}

	function handleGridKeydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		const currentKey = target?.dataset.date;
		if (!currentKey) return;
		const current = parseDateInput(currentKey);
		if (!current) return;

		const shift = (days: number) =>
			new Date(current.getFullYear(), current.getMonth(), current.getDate() + days);
		const weekdayOffset = (current.getDay() - weekStartsOn + 7) % 7;

		let next: Date;
		switch (event.key) {
			case 'ArrowLeft':
				next = shift(-1);
				break;
			case 'ArrowRight':
				next = shift(1);
				break;
			case 'ArrowUp':
				next = shift(-7);
				break;
			case 'ArrowDown':
				next = shift(7);
				break;
			case 'Home':
				next = shift(-weekdayOffset);
				break;
			case 'End':
				next = shift(6 - weekdayOffset);
				break;
			case 'PageUp':
				event.preventDefault();
				shiftMonth(-1, current.getDate());
				return;
			case 'PageDown':
				event.preventDefault();
				shiftMonth(1, current.getDate());
				return;
			default:
				return;
		}

		event.preventDefault();
		if (next.getMonth() !== viewMonth || next.getFullYear() !== viewYear) {
			viewYear = next.getFullYear();
			viewMonth = next.getMonth();
		}
		void tick().then(() => focusDayButton(dateInputKey(next)));
	}

	// ── Responsive presentation + top-layer panel ────────────────────────────
	$effect(() => {
		if (!browser) return;
		const query = window.matchMedia('(max-width: 639px)');
		isMobile = query.matches;
		const onChange = (event: MediaQueryListEvent) => (isMobile = event.matches);
		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	});

	function portal(node: HTMLElement) {
		if (!browser) return;
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	function place() {
		if (!browser || !triggerEl) return;
		const anchor = triggerEl.getBoundingClientRect();
		const panelHeight = panelEl?.offsetHeight ?? 360;
		const panelWidth = panelEl?.offsetWidth ?? FALLBACK_PANEL_WIDTH;
		const margin = 8;
		const spaceBelow = window.innerHeight - anchor.bottom;
		const openUpward = spaceBelow < panelHeight + margin && anchor.top > panelHeight + margin;
		const top = openUpward
			? Math.max(margin, anchor.top - panelHeight - 6)
			: Math.min(anchor.bottom + 6, window.innerHeight - panelHeight - margin);
		const preferredLeft = align === 'end' ? anchor.right - panelWidth : anchor.left;
		const maxLeft = window.innerWidth - panelWidth - margin;
		position = {
			top: Math.max(margin, top),
			left: Math.max(margin, Math.min(preferredLeft, maxLeft))
		};
	}

	$effect(() => {
		if (!open || isMobile) return;
		const el = panelEl;
		if (!el) return;
		if (typeof el.showPopover === 'function') {
			try {
				el.showPopover();
			} catch {
				el.removeAttribute('popover');
			}
		}
		place();
		const onViewportChange = () => place();
		window.addEventListener('resize', onViewportChange);
		window.addEventListener('scroll', onViewportChange, true);
		return () => {
			window.removeEventListener('resize', onViewportChange);
			window.removeEventListener('scroll', onViewportChange, true);
			try {
				if (el.matches(':popover-open')) el.hidePopover();
			} catch {
				/* already detached or unsupported */
			}
		};
	});

	$effect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (wrapperEl?.contains(target) || panelEl?.contains(target) || sheetEl?.contains(target)) {
				return;
			}
			close();
		};
		const onKeydown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			// Capture + stop so an enclosing Dialog does not close as well.
			event.preventDefault();
			event.stopPropagation();
			close(true);
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('keydown', onKeydown, true);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeydown, true);
		};
	});
</script>

{#snippet calendar()}
	<div class={isMobile ? '' : 'w-76'}>
		<div class="flex items-center justify-between gap-1 pb-2">
			<Button
				variant="ghost"
				size="icon-sm"
				icon="lucide:chevron-left"
				aria-label={t('datePicker.previousMonth')}
				onclick={() => shiftMonth(-1)}
			/>
			<div class="text-[13px] font-semibold capitalize" aria-live="polite">{monthLabel}</div>
			<Button
				variant="ghost"
				size="icon-sm"
				icon="lucide:chevron-right"
				aria-label={t('datePicker.nextMonth')}
				onclick={() => shiftMonth(1)}
			/>
		</div>

		<table
			class="w-full border-separate border-spacing-0"
			role="grid"
			aria-label={monthLabel}
			onkeydown={handleGridKeydown}
		>
			<thead>
				<tr>
					{#each weekdayLabels as label, index (index)}
						<th
							scope="col"
							class="pb-1.5 text-[10px] font-semibold tracking-wide text-(--ui-text-dimmed) uppercase"
						>
							{label}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each weeks as week, weekIndex (weekIndex)}
					<tr>
						{#each week as cell (cell.key)}
							<td class="p-0 text-center">
								<button
									type="button"
									data-date={cell.key}
									tabindex={cell.key === focusKey ? 0 : -1}
									aria-label={cell.label}
									aria-pressed={cell.key === selectedKey}
									disabled={cell.disabled}
									onclick={() => selectDay(cell.key)}
									class={cn(
										'focus-ring size-9 rounded-lg text-[12.5px] font-medium tabular-nums transition-colors',
										cell.key === selectedKey
											? 'bg-primary-500 text-white shadow-sm'
											: cell.key === todayKey
												? 'text-primary-600 ring-1 ring-primary-500/40 ring-inset hover:bg-(--ui-bg-accented) dark:text-primary-400'
												: 'hover:bg-(--ui-bg-accented)',
										cell.outside &&
											cell.key !== selectedKey &&
											'text-(--ui-text-dimmed) opacity-60',
										cell.disabled && 'pointer-events-none opacity-30'
									)}
								>
									{cell.day}
								</button>
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>

		{#if mode === 'datetime'}
			<div
				class="focus-ring-field mt-2 flex items-center justify-between gap-3 rounded-lg border border-(--ui-border) bg-(--ui-bg-muted) px-3"
			>
				<label for="{panelId}-time" class="text-[12px] font-semibold text-(--ui-text-muted)"
					>{t('common.time')}</label
				>
				<input
					id="{panelId}-time"
					type="time"
					value={timeValue}
					oninput={(event) => setTime(event.currentTarget.value)}
					class="h-9 bg-transparent text-right text-[13px] text-(--ui-text) tabular-nums focus:outline-none"
				/>
			</div>
		{/if}

		<div
			class="mt-2 flex items-center justify-between gap-2 border-t border-(--ui-border-muted) pt-2"
		>
			<Button variant="ghost" size="sm" onclick={goToday}>{t('common.today')}</Button>
			{#if mode === 'datetime'}
				<div class="flex items-center gap-2">
					<Button
						variant="ghost"
						size="sm"
						icon="lucide:rotate-ccw"
						disabled={!value}
						onclick={clearValue}>{t('common.clear')}</Button
					>
					<Button color="primary" size="sm" onclick={() => close(true)}>{t('common.done')}</Button>
				</div>
			{/if}
		</div>
	</div>
{/snippet}

<div
	bind:this={wrapperEl}
	class={cn(
		'focus-ring-field relative inline-flex items-center rounded-lg border border-(--ui-border) bg-(--ui-bg-muted) transition-colors',
		height,
		disabled ? 'opacity-60' : 'hover:border-(--ui-border-accented)',
		open && 'border-(--ui-color-primary-500)',
		cls
	)}
>
	<button
		{id}
		bind:this={triggerEl}
		type="button"
		{disabled}
		aria-haspopup="dialog"
		aria-controls={open ? panelId : undefined}
		aria-expanded={open}
		aria-label={accessibleName}
		onclick={toggle}
		class="flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg bg-transparent px-3 text-left text-[13.5px] focus:outline-none disabled:cursor-not-allowed"
	>
		<Icon
			name={mode === 'datetime' ? 'lucide:calendar-clock' : 'lucide:calendar'}
			class="size-4 shrink-0 text-(--ui-text-dimmed)"
		/>
		<span
			class={cn(
				'min-w-0 flex-1 truncate',
				displayText ? 'text-(--ui-text)' : 'text-(--ui-text-dimmed)'
			)}
		>
			{displayText || placeholder || t('common.date')}
		</span>
		<Icon name="lucide:chevron-down" class="size-3.5 shrink-0 text-(--ui-text-dimmed)" />
	</button>
	{#if value && clearable && !disabled}
		<button
			type="button"
			aria-label={t('common.clear')}
			title={t('common.clear')}
			onclick={clearValue}
			class="mr-1.5 grid size-6 shrink-0 place-items-center rounded-md text-(--ui-text-dimmed) transition-colors hover:bg-(--ui-bg-accented) hover:text-(--ui-text)"
		>
			<Icon name="lucide:x" class="size-3.5" />
		</button>
	{/if}
</div>

{#if open}
	{#if isMobile}
		<div use:portal class="fixed inset-0 z-[96]">
			<button
				type="button"
				aria-label={t('common.close')}
				tabindex="-1"
				class="animate-fade absolute inset-0 bg-black/45 backdrop-blur-[2px]"
				onclick={() => close()}
			></button>
			<div
				bind:this={sheetEl}
				id={panelId}
				tabindex="-1"
				role="dialog"
				aria-modal="true"
				aria-label={t('common.date')}
				class="animate-sheet-up absolute inset-x-0 bottom-0 rounded-t-2xl border border-(--ui-border) bg-(--surface-bg) px-4 pt-2.5 pb-[calc(1rem+env(safe-area-inset-bottom))] text-(--ui-text) shadow-(--shadow-pop) outline-none"
			>
				<div
					class="mx-auto mb-2 h-1 w-9 rounded-full bg-(--ui-border-accented)"
					aria-hidden="true"
				></div>
				<button
					type="button"
					aria-label={t('common.close')}
					onclick={() => close(true)}
					class="absolute top-2 right-3 grid size-8 place-items-center rounded-lg text-(--ui-text-dimmed) transition-colors hover:bg-(--ui-bg-accented) hover:text-(--ui-text)"
				>
					<Icon name="lucide:x" class="size-4" />
				</button>
				{@render calendar()}
			</div>
		</div>
	{:else}
		<div
			bind:this={panelEl}
			use:portal
			id={panelId}
			popover="manual"
			tabindex="-1"
			role="dialog"
			aria-label={t('common.date')}
			class="animate-rise fixed inset-auto m-0 rounded-xl border border-(--ui-border) bg-(--surface-bg) p-3 text-(--ui-text) shadow-(--shadow-pop) outline-none"
			style:top="{position.top}px"
			style:left="{position.left}px"
		>
			{@render calendar()}
		</div>
	{/if}
{/if}
