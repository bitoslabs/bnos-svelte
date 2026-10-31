import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DateTimePicker from './DateTimePicker.svelte';

const fullDate = new Intl.DateTimeFormat('en-US', { dateStyle: 'full' });
const shortDate = new Intl.DateTimeFormat('en-US', {
	day: 'numeric',
	month: 'short',
	year: 'numeric'
});
const today = new Date();

const realMatchMedia = window.matchMedia;

afterEach(() => {
	window.matchMedia = realMatchMedia;
});

describe('DateTimePicker', () => {
	it('picks a day from the calendar and closes', async () => {
		const screen = await render(DateTimePicker, { value: '' });

		await screen.getByRole('button', { name: 'Date' }).click();
		await screen.getByRole('button', { name: fullDate.format(today) }).click();

		await expect
			.element(screen.getByRole('button', { name: shortDate.format(today) }))
			.toBeVisible();
	});

	it('opens on the month of the current value', async () => {
		const screen = await render(DateTimePicker, { value: '2026-01-05' });

		await screen.getByRole('button', { name: 'Jan 5, 2026' }).click();

		await expect.element(screen.getByText('January 2026')).toBeVisible();
	});

	it('clears the value from the trigger', async () => {
		const screen = await render(DateTimePicker, { value: '2026-01-05' });

		await screen.getByRole('button', { name: 'Clear' }).click();

		await expect.element(screen.getByRole('button', { name: 'Date' })).toBeVisible();
	});

	it('renders a top-layer panel on desktop widths', async () => {
		window.matchMedia = ((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener() {},
			removeEventListener() {},
			addListener() {},
			removeListener() {},
			dispatchEvent: () => false
		})) as unknown as typeof window.matchMedia;

		const screen = await render(DateTimePicker, { value: '' });
		await screen.getByRole('button', { name: 'Date' }).click();

		await expect
			.element(screen.getByRole('button', { name: fullDate.format(today) }))
			.toBeVisible();
		await expect.element(screen.getByRole('dialog')).toBeVisible();
	});
});
