import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import NumberInput from './NumberInput.svelte';

describe('NumberInput', () => {
	it('groups thousands while typing', async () => {
		const screen = await render(NumberInput, { value: 0 });
		const input = screen.getByRole('textbox');
		await input.fill('1234567');
		await expect.element(input).toHaveValue('1,234,567');
	});

	it('strips non-numeric characters instead of rejecting the edit', async () => {
		const screen = await render(NumberInput, { value: 0 });
		const input = screen.getByRole('textbox');
		await input.fill('12abc');
		await expect.element(input).toHaveValue('12');
	});

	it('caps fraction digits while typing', async () => {
		const screen = await render(NumberInput, { value: 0, maxDecimals: 2 });
		const input = screen.getByRole('textbox');
		await input.fill('1.239');
		await expect.element(input).toHaveValue('1.23');
	});

	it('pads fixed decimals on blur', async () => {
		const screen = await render(NumberInput, { value: 0, decimals: 2 });
		const input = screen.getByRole('textbox');
		await input.fill('1500');
		input.element().dispatchEvent(new FocusEvent('blur'));
		await expect.element(input).toHaveValue('1,500.00');
	});

	it('clamps to the minimum on blur', async () => {
		const screen = await render(NumberInput, { value: 0, min: 10, decimals: 2 });
		const input = screen.getByRole('textbox');
		await input.fill('2');
		input.element().dispatchEvent(new FocusEvent('blur'));
		await expect.element(input).toHaveValue('10.00');
	});
});
