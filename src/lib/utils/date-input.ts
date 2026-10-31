/**
 * Calendar-date helpers for `yyyy-mm-dd` / `yyyy-mm-ddTHH:mm` input values.
 *
 * Everything works in **local** time on purpose: a ledger date is a calendar
 * day for the user, not a UTC instant. Parsing `yyyy-mm-dd` with `new Date()`
 * would treat it as UTC midnight and shift the day for negative offsets.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** Local-time `yyyy-mm-dd` key for a date. */
export function dateInputKey(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today as a local `yyyy-mm-dd` key. */
export function todayDateInput(): string {
	return dateInputKey(new Date());
}

/** Parse `yyyy-mm-dd` (or a datetime value) as a local calendar date. */
export function parseDateInput(value: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(year, month - 1, day);
	return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
		? date
		: null;
}

/** Split a `date` / `datetime-local` value into its `date` and `time` parts. */
export function parseDateTimeInput(value: string): { date: string; time: string } {
	const [date = '', time = ''] = value.split('T');
	return { date, time: time.slice(0, 5) };
}

/** Compose a `datetime-local` value, defaulting the time to midnight. */
export function combineDateTimeInput(date: string, time: string): string {
	return `${date}T${time || '00:00'}`;
}

/**
 * Day bounds for a two-ended range, order-agnostic. `endExclusive` is local
 * midnight of the day after the later bound, so `start <= t < endExclusive`
 * covers both whole days.
 */
export function dateRangeBounds(
	from: string,
	to: string
): { start: number | null; endExclusive: number | null } {
	const a = parseDateInput(from);
	const b = parseDateInput(to);
	if (!a && !b) return { start: null, endExclusive: null };

	const first = a && b ? (a.getTime() <= b.getTime() ? a : b) : (a ?? b)!;
	const last = a && b ? (a.getTime() <= b.getTime() ? b : a) : (a ?? b)!;
	const endExclusive = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);

	return { start: first.getTime(), endExclusive: endExclusive.getTime() };
}
