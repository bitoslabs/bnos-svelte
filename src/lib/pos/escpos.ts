/**
 * Minimal ESC/POS binary receipt encoder for thermal POS printers (Xprinter, Epson, Star).
 */
import type { Printer } from '$lib/settings/printers';

export interface EscPosLineItem {
	label: string;
	amount: string;
}

export interface EscPosMetaRow {
	label: string;
	value: string;
}

export interface EscPosReceiptData {
	header?: string;
	storeName?: string;
	phone?: string;
	address?: string;
	taxId?: string;
	meta: EscPosMetaRow[];
	items: EscPosLineItem[];
	totals: { label: string; amount: string; bold?: boolean }[];
	payments: EscPosLineItem[];
	footer?: string;
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const encoder = new TextEncoder();

/** Replace common Unicode symbols/spaces that raw ESC/POS codepages render poorly. */
function normalizeText(input: string): string {
	return input
		.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
		.replace(/×/g, 'x')
		.replace(/−/g, '-')
		.replace(/≈/g, '~')
		.replace(/[“”]/g, '"')
		.replace(/[‘’]/g, "'");
}

function formatColumns(left: string, right: string, width: number): string {
	const l = normalizeText(left);
	const r = normalizeText(right);
	if (!r) return l;
	if (l.length + r.length + 1 <= width) {
		return l + ' '.repeat(width - l.length - r.length) + r;
	}
	const maxLeft = Math.max(4, width - r.length - 1);
	const truncated = l.length > maxLeft ? `${l.slice(0, maxLeft - 1)}.` : l;
	return truncated + ' '.repeat(Math.max(1, width - truncated.length - r.length)) + r;
}

class EscPosBuilder {
	private chunks: number[] = [];

	raw(...bytes: number[]) {
		this.chunks.push(...bytes);
		return this;
	}

	init() {
		// ESC @ (initialize), FS . (exit Chinese/Kanji 2-byte mode), ESC t 0 (PC437)
		return this.raw(ESC, 0x40, 0x1c, 0x2e, ESC, 0x74, 0x00);
	}

	align(mode: 'left' | 'center' | 'right') {
		const n = mode === 'center' ? 1 : mode === 'right' ? 2 : 0;
		return this.raw(ESC, 0x61, n);
	}

	bold(on: boolean) {
		return this.raw(ESC, 0x45, on ? 1 : 0);
	}

	doubleSize(on: boolean) {
		return this.raw(GS, 0x21, on ? 0x11 : 0x00);
	}

	text(str: string) {
		const bytes = encoder.encode(normalizeText(str));
		for (const b of bytes) this.chunks.push(b);
		return this;
	}

	line(str = '') {
		if (str) this.text(str);
		return this.raw(LF);
	}

	rule(width: number, char = '-') {
		return this.line(char.repeat(width));
	}

	feed(lines = 3) {
		return this.raw(ESC, 0x64, Math.max(0, Math.min(255, lines)));
	}

	cut(mode: 'full' | 'partial') {
		return this.raw(GS, 0x56, mode === 'partial' ? 1 : 0);
	}

	kickDrawer() {
		return this.raw(ESC, 0x70, 0x00, 25, 250);
	}

	build(): Uint8Array {
		return new Uint8Array(this.chunks);
	}
}

function effectiveWidth(printer: Printer): number {
	const fallback = printer.paperSize === '58mm' ? 32 : 48;
	const n = printer.charsPerLine || fallback;
	return Math.max(16, Math.min(96, n));
}

export function buildEscPosReceipt(data: EscPosReceiptData, printer: Printer): Uint8Array {
	const width = effectiveWidth(printer);
	const copies = Math.max(1, Math.min(5, printer.copies || 1));
	const b = new EscPosBuilder();

	for (let c = 0; c < copies; c++) {
		b.init();

		b.align('center');
		if (data.header) b.line(data.header);
		if (data.storeName) {
			b.bold(true).doubleSize(true).line(data.storeName).doubleSize(false).bold(false);
		}
		if (data.phone) b.line(`Tel: ${data.phone}`);
		if (data.address) b.line(data.address);
		if (data.taxId) b.line(`Tax ID: ${data.taxId}`);

		b.align('left').rule(width);
		for (const row of data.meta) {
			b.line(formatColumns(row.label, row.value, width));
		}

		if (data.items.length > 0) {
			b.rule(width);
			for (const item of data.items) {
				b.line(formatColumns(item.label, item.amount, width));
			}
		}

		if (data.totals.length > 0) {
			b.rule(width);
			for (const tot of data.totals) {
				if (tot.bold) b.bold(true);
				b.line(formatColumns(tot.label, tot.amount, width));
				if (tot.bold) b.bold(false);
			}
		}

		if (data.payments.length > 0) {
			b.rule(width);
			for (const pay of data.payments) {
				b.line(formatColumns(pay.label, pay.amount, width));
			}
		}

		b.rule(width);
		if (data.footer) {
			b.align('center').line(data.footer).align('left');
		}

		b.feed(4);
		if (printer.autoCut) b.cut(printer.cutMode ?? 'full');
		if (c === 0 && printer.cashDrawerEnabled) b.kickDrawer();
	}

	return b.build();
}

export function buildTestReceiptBytes(printer: Printer): Uint8Array {
	const width = effectiveWidth(printer);
	const b = new EscPosBuilder()
		.init()
		.align('center')
		.bold(true)
		.doubleSize(true)
		.line('BNOS POS')
		.doubleSize(false)
		.bold(false)
		.line('Printer Test OK')
		.align('left')
		.rule(width)
		.line(formatColumns('Printer', printer.name || printer.id, width))
		.line(formatColumns('Target', `${printer.ip}:${printer.port || '9100'}`, width))
		.line(formatColumns('Paper', printer.paperSize, width))
		.line(formatColumns('Time', new Date().toLocaleString(), width))
		.rule(width)
		.feed(4);

	if (printer.autoCut) b.cut(printer.cutMode ?? 'full');
	return b.build();
}

export function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}
	return btoa(binary);
}
