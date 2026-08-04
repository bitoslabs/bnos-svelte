/**
 * Customer-facing receipt printer for a just-completed POS sale.
 *
 * Why this lives apart from `print.ts`
 * -----------------------------------
 * `print.ts` builds receipts from a persisted GLO `Order` (used by the Orders
 * area). The POS "Sale complete" / auto-print flow prints from the in-memory
 * `CompletedSale` snapshot (the cart is already cleared by then), which has a
 * different shape and also carries the applied promotion/coupon name. Keeping
 * the two builders separate avoids forcing one to impersonate the other; both
 * honour the same Receipt settings.
 *
 * Unlike the old inline builder in the POS page, this prints the full
 * breakdown: subtotal, discount (with the promotion/coupon label when one was
 * applied), tax, total, tender method and change.
 */
import type { ReceiptSettings } from '$lib/settings/local';
import { formatMoney } from '$lib/utils/format';
import type { CompletedSale } from './cart.svelte';
import { toast } from '$lib/stores/toast.svelte';

export interface PrintPosReceiptOptions {
	receipt: ReceiptSettings;
	currency: string;
	cashier?: string;
	customerName?: string;
	/** Optional sats equivalent of the total (shown under TOTAL when provided). */
	satsTotal?: number;
}

function esc(s: unknown): string {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

function openWindow(width: number) {
	const w = window.open('', '_blank', `width=${width},height=720`);
	if (!w) {
		toast.warning('Pop-ups blocked', 'Allow pop-ups for this site to print receipts.');
		return null;
	}
	return w;
}

/** Print a POS `CompletedSale` as a customer receipt, honouring Receipt settings. */
export function printPosReceipt(sale: CompletedSale, opts: PrintPosReceiptOptions) {
	const s = sale;
	const r = opts.receipt;
	const currency = opts.currency;
	const width = r.paperSize === '58mm' ? 320 : 420;
	const paperWidth = r.paperSize === '58mm' ? '58mm' : '80mm';
	const fontSize = r.paperSize === '58mm' ? '10px' : '12px';

	const modTotal = (it: CompletedSale['items'][number]) =>
		(it.modifiers ?? []).reduce((a, m) => a + m.priceAdjustment, 0);
	const lineTotal = (it: CompletedSale['items'][number]) =>
		(it.unitPrice + modTotal(it)) * it.quantity;

	const itemsHtml = s.items
		.map((it) => {
			const name = `${it.quantity}× ${it.name}${it.variantName ? ` (${it.variantName})` : ''}`;
			return `<tr><td>${esc(name)}</td><td class="right">${formatMoney(lineTotal(it), currency)}</td></tr>`;
		})
		.join('');

	const headerHtml = [
		r.showLogo && r.logoUrl
			? `<div class="center"><img src="${esc(r.logoUrl)}" style="max-height:48px;object-fit:contain"/></div>`
			: '',
		r.header ? `<div class="center muted">${esc(r.header)}</div>` : '',
		r.showStoreName ? `<h2>${esc(r.storeName || 'Store')}</h2>` : '',
		r.showPhone && r.phone ? `<div class="center muted">Tel: ${esc(r.phone)}</div>` : '',
		r.showAddress && r.address ? `<div class="center muted">${esc(r.address)}</div>` : '',
		r.showTaxId && r.taxId ? `<div class="center muted">Tax ID: ${esc(r.taxId)}</div>` : ''
	].join('');

	const metaHtml = [
		r.showDate
			? `<tr><td>Date</td><td class="right">${esc(new Date(s.completedAt).toLocaleString())}</td></tr>`
			: '',
		r.showOrderNumber ? `<tr><td>Order</td><td class="right">${esc(s.number)}</td></tr>` : '',
		r.showCashierName && opts.cashier
			? `<tr><td>Cashier</td><td class="right">${esc(opts.cashier)}</td></tr>`
			: '',
		opts.customerName
			? `<tr><td>Customer</td><td class="right">${esc(opts.customerName)}</td></tr>`
			: '',
		`<tr><td>Type</td><td class="right">${esc(s.orderType.replace('_', ' '))}</td></tr>`
	].join('');

	// Totals: subtotal → discount (+ promotion/coupon label) → tax → total.
	const promoLabel = s.promotion?.name ? ` (${esc(s.promotion.name)})` : '';
	const discountRow =
		s.totals.discountAmount > 0
			? `<tr><td>Discount${promoLabel}</td><td class="right">−${formatMoney(s.totals.discountAmount, currency)}</td></tr>`
			: s.promotion
				? `<tr><td>Promo</td><td class="right">${esc(s.promotion.name)}</td></tr>`
				: '';
	const totalsHtml = [
		`<tr><td>Subtotal</td><td class="right">${formatMoney(s.totals.subtotal, currency)}</td></tr>`,
		discountRow,
		`<tr><td>Tax</td><td class="right">${formatMoney(s.totals.tax, currency)}</td></tr>`,
		`<tr class="total"><td>TOTAL</td><td class="right">${formatMoney(s.totals.total, currency)}</td></tr>`,
		opts.satsTotal && opts.satsTotal > 0
			? `<tr><td>in sats</td><td class="right">≈ ${opts.satsTotal.toLocaleString()} sats</td></tr>`
			: ''
	].join('');

	const tenderHtml = [
		`<tr><td>${esc(s.method)}</td><td class="right">${formatMoney(s.totals.total, currency)}</td></tr>`,
		s.change > 0
			? `<tr><td>Change</td><td class="right">${formatMoney(s.change, currency)}</td></tr>`
			: ''
	].join('');

	const optionalHtml = [
		r.showBarcode
			? `<div class="center" style="font-family:monospace;font-size:20px;letter-spacing:3px;margin-top:8px">${esc(s.number)}</div>`
			: '',
		r.showQr && r.qrData
			? `<div class="center" style="margin-top:6px"><img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(r.qrData)}" width="120" height="120" alt="QR"/></div>`
			: ''
	].join('');

	const style = `
		@page { size: ${paperWidth} auto; margin: 4mm; }
		* { box-sizing: border-box; }
		body { width: ${paperWidth}; margin: 0 auto; padding: 8px; font-family: 'Courier New', ui-monospace, monospace; font-size: ${fontSize}; color: #000; }
		h2 { text-align: center; margin: 4px 0; font-size: 1.25em; }
		table { width: 100%; border-collapse: collapse; }
		td { padding: 2px 0; vertical-align: top; }
		.dashed { border-top: 1px dashed #000; margin: 6px 0; }
		.right { text-align: right; white-space: nowrap; }
		.center { text-align: center; }
		.muted { color: #555; }
		.total { font-weight: 700; font-size: 1.15em; }
		@media print { body { padding: 0; } }
	`;

	const w = openWindow(width);
	if (!w) return;
	w.document.write(
		`<!doctype html><html><head><meta charset="utf-8"/><title>Receipt ${esc(s.number)}</title><style>${style}</style></head><body>` +
			headerHtml +
			`<div class="dashed"></div><table>${metaHtml}</table>` +
			`<div class="dashed"></div><table>${itemsHtml}</table>` +
			`<div class="dashed"></div><table>${totalsHtml}</table>` +
			`<div class="dashed"></div><table>${tenderHtml}</table>` +
			optionalHtml +
			`<div class="dashed"></div>` +
			(r.footer ? `<div class="center muted">${esc(r.footer)}</div>` : '') +
			`</body></html>`
	);
	w.document.close();
	w.focus();
	w.print();
}
