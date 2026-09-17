/**
 * Shared print helpers for the Orders area.
 *
 * `printReceiptForOrder` applies the merchant's Receipt settings (logo, header,
 * footer, tax id, toggles, paper size) — previously the orders list/detail
 * `print` ignored those settings entirely and printed a hardcoded stub.
 *
 * `printPackingSlip` is a packer-facing document: items + quantities + ship-to
 * address, no prices — for "slip package send to customer" / fulfilment.
 */
import type { Order, Refund } from '$lib/domain';
import { loadReceiptSettings } from '$lib/settings/local';
import { formatMoney } from '$lib/utils/format';
import { sourceLabel } from '$lib/domain/order-sources';
import { toast } from '$lib/stores/toast.svelte';

export interface PrintOrderOptions {
	currency?: string;
	/** Payments may be raw `Payment` objects or GLO-wrapped `{ data: Payment }`. */
	payments?: readonly unknown[];
	/** Optional sats equivalent of the total (shown under TOTAL when provided). */
	satsTotal?: number;
}

function esc(s: unknown): string {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function lineName(line: any): string {
	const base = line.productName || line.name || 'Item';
	return line.variantName ? `${base} (${line.variantName})` : base;
}

function lineQty(line: any): number {
	return Number(line.quantity ?? 1) || 1;
}

function lineUnit(line: any): number {
	return Number(line.unitPrice ?? line.price ?? 0) || 0;
}

function orderNumber(o: Order): string {
	return String((o as any).orderNumber ?? o.number ?? '');
}

function openWindow(width = 420) {
	const w = window.open('', '_blank', `width=${width},height=720`);
	if (!w) {
		toast.warning('Pop-ups blocked', 'Allow pop-ups for this site to print receipts.');
		return null;
	}
	return w;
}

const BASE_STYLE = `
	body { font-family: 'Courier New', ui-monospace, monospace; padding: 14px; font-size: 12px; color: #000; }
	h2 { text-align: center; margin: 0 0 2px; font-size: 15px; }
	.center { text-align: center; }
	.muted { color: #555; font-size: 10px; }
	table { width: 100%; border-collapse: collapse; }
	td { padding: 2px 0; vertical-align: top; }
	.right { text-align: right; }
	.bold { font-weight: 700; }
	.dashed { border-top: 1px dashed #000; margin: 6px 0; }
	.total { font-weight: 700; font-size: 14px; }
	.pill { display: inline-block; border: 1px solid #000; border-radius: 3px; padding: 1px 5px; font-size: 10px; }
	@media print { body { padding: 0; } }
`;

/** Customer-facing receipt that honours Receipt settings. */
export function printReceiptForOrder(order: { data: Order }, opts: PrintOrderOptions = {}) {
	const d = order.data as any;
	const s = loadReceiptSettings();
	const currency = opts.currency ?? d.currency ?? 'USD';
	const width = s.paperSize === '58mm' ? 320 : 420;

	const lines = (d.lines ?? []) as any[];
	const itemsHtml = lines
		.map(
			(l) =>
				`<tr><td>${lineQty(l)}× ${esc(lineName(l))}</td><td class="right">${formatMoney(
					((lineUnit(l) +
						(l.modifiers ?? []).reduce(
							(a: number, m: any) => a + (m.priceAdjustment ?? 0),
							0
						)) as number) * lineQty(l),
					currency
				)}</td></tr>`
		)
		.join('');

	const payments = opts.payments ?? [];
	const paymentsHtml = payments.length
		? payments
				.map((p) => {
					const pd: any = (p as any).data ?? p;
					return `<tr><td>${esc(pd.method ?? 'payment')}</td><td class="right">${formatMoney(pd.amount ?? 0, currency)}</td></tr>`;
				})
				.join('')
		: '';

	const rows: string[] = [];
	if (s.showLogo && s.logoUrl)
		rows.push(
			`<div class="center"><img src="${esc(s.logoUrl)}" style="max-height:48px;object-fit:contain"/></div>`
		);
	if (s.header) rows.push(`<div class="center muted">${esc(s.header)}</div>`);
	if (s.showStoreName) rows.push(`<h2>${esc(s.storeName || 'Store')}</h2>`);
	if (s.showPhone && s.phone) rows.push(`<div class="center muted">Tel: ${esc(s.phone)}</div>`);
	if (s.showAddress && s.address) rows.push(`<div class="center muted">${esc(s.address)}</div>`);
	if (s.showTaxId && s.taxId) rows.push(`<div class="center muted">Tax ID: ${esc(s.taxId)}</div>`);
	rows.push('<div class="dashed"></div>');
	if (s.showDate)
		rows.push(
			`<table><tr><td>Date</td><td class="right">${new Date(d.occurredAt ?? Date.now()).toLocaleString()}</td></tr></table>`
		);
	if (s.showOrderNumber)
		rows.push(
			`<table><tr><td>Order</td><td class="right">#${esc(orderNumber(d))}</td></tr></table>`
		);
	if (d.customerName)
		rows.push(
			`<table><tr><td>Customer</td><td class="right">${esc(d.customerName)}</td></tr></table>`
		);
	if (s.showCashierName && d.cashierPubkey)
		rows.push(
			`<table><tr><td>Cashier</td><td class="right">${esc(d.cashierPubkey)}</td></tr></table>`
		);
	rows.push('<div class="dashed"></div>');
	rows.push(`<table>${itemsHtml}</table>`);
	rows.push('<div class="dashed"></div>');

	const totals: string[] = [];
	if (d.subtotal != null)
		totals.push(
			`<tr><td>Subtotal</td><td class="right">${formatMoney(d.subtotal, currency)}</td></tr>`
		);
	if (d.discount)
		totals.push(
			`<tr><td>Discount</td><td class="right">-${formatMoney(d.discount, currency)}</td></tr>`
		);
	if (d.taxAmount ?? d.tax)
		totals.push(
			`<tr><td>Tax</td><td class="right">${formatMoney(d.taxAmount ?? d.tax, currency)}</td></tr>`
		);
	if (d.tip)
		totals.push(`<tr><td>Tip</td><td class="right">${formatMoney(d.tip, currency)}</td></tr>`);
	totals.push(
		`<tr class="total"><td>TOTAL</td><td class="right">${formatMoney(d.total ?? 0, currency)}</td></tr>`
	);
	if (opts.satsTotal && opts.satsTotal > 0)
		totals.push(
			`<tr><td>in sats</td><td class="right">≈ ${opts.satsTotal.toLocaleString()} sats</td></tr>`
		);
	rows.push(`<table>${totals.join('')}</table>`);

	if (paymentsHtml) {
		rows.push('<div class="dashed"></div>');
		rows.push(`<table>${paymentsHtml}</table>`);
	}
	if (s.showBarcode)
		rows.push(
			`<div class="center" style="font-family:monospace;font-size:22px;letter-spacing:3px">||||||||</div>`
		);
	if (s.showQr && s.qrData)
		rows.push(
			`<div class="center" style="margin-top:6px"><img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(
				s.qrData
			)}" width="120" height="120" alt="QR"/></div>`
		);
	rows.push('<div class="dashed"></div>');
	if (s.footer) rows.push(`<div class="center muted">${esc(s.footer)}</div>`);

	const w = openWindow(width);
	if (!w) return;
	w.document.write(
		`<!doctype html><html><head><meta charset="utf-8"/><title>Receipt ${esc(orderNumber(d))}</title><style>${BASE_STYLE}</style></head><body>${rows.join(
			''
		)}</body></html>`
	);
	w.document.close();
	w.focus();
	w.print();
}

/** Packer-facing slip: items + qty + ship-to, NO prices. */
export function printPackingSlip(order: { data: Order }) {
	const d = order.data as any;
	const s = loadReceiptSettings();
	const lines = (d.lines ?? []) as any[];

	const itemsHtml = lines
		.map(
			(l) =>
				`<tr><td>☐</td><td class="bold">${lineQty(l)}</td><td>${esc(lineName(l))}${
					l.modifiers?.length
						? `<div class="muted">${l.modifiers.map((m: any) => esc(m.name)).join(', ')}</div>`
						: ''
				}${l.notes ? `<div class="muted">↳ ${esc(l.notes)}</div>` : ''}</td></tr>`
		)
		.join('');

	const ship = d.shipping;
	const pickup = d.pickup;
	const addressLines: string[] = [];
	if (ship) {
		if (ship.recipientName) addressLines.push(esc(ship.recipientName));
		if (ship.phone) addressLines.push(`Tel: ${esc(ship.phone)}`);
		if (ship.address) addressLines.push(esc(ship.address));
		if (ship.city || ship.state || ship.zipCode)
			addressLines.push(
				`${[ship.city, ship.state].filter(Boolean).join(', ')} ${esc(ship.zipCode ?? '')}`
			);
		if (ship.country) addressLines.push(esc(ship.country));
		if (ship.trackingNumber)
			addressLines.push(`<span class="pill">Tracking: ${esc(ship.trackingNumber)}</span>`);
	} else if (pickup) {
		if (pickup.pickupName) addressLines.push(esc(pickup.pickupName));
		if (pickup.phone) addressLines.push(`Tel: ${esc(pickup.phone)}`);
		if (pickup.pickupLocation) addressLines.push(`Pickup at: ${esc(pickup.pickupLocation)}`);
		if (pickup.pickupTime)
			addressLines.push(`Ready: ${esc(new Date(pickup.pickupTime).toLocaleString())}`);
	} else if (d.customerName) {
		addressLines.push(esc(d.customerName));
	}

	const shipBlock = addressLines.length
		? `<div class="dashed"></div><div class="bold">SHIP TO</div><div>${addressLines.join('<br/>')}</div>`
		: '';

	const w = openWindow(420);
	if (!w) return;
	w.document.write(
		`<!doctype html><html><head><meta charset="utf-8"/><title>Packing slip ${esc(orderNumber(d))}</title><style>${BASE_STYLE}
		.qty { width: 28px; text-align: center; font-size: 14px; }
		.chk { width: 18px; }
		</style></head><body>
		${s.showLogo && s.logoUrl ? `<div class="center"><img src="${esc(s.logoUrl)}" style="max-height:40px;object-fit:contain"/></div>` : ''}
		<h2>PACKING SLIP</h2>
		<div class="center muted">${esc(s.storeName || '')}</div>
		<div class="dashed"></div>
		<table>
			<tr><td>Order</td><td class="right bold">#${esc(orderNumber(d))}</td></tr>
			<tr><td>Date</td><td class="right">${new Date(d.occurredAt ?? Date.now()).toLocaleDateString()}</td></tr>
			${d.source ? `<tr><td>Source</td><td class="right">${esc(sourceLabel(d.source))}</td></tr>` : ''}
			${d.type ? `<tr><td>Type</td><td class="right">${esc(d.type)}</td></tr>` : ''}
		</table>
		${shipBlock}
		<div class="dashed"></div>
		<table><thead><tr><th class="chk"></th><th class="qty">Qty</th><th style="text-align:left">Item</th></tr></thead><tbody>${itemsHtml}</tbody></table>
		${d.notes ? `<div class="dashed"></div><div class="bold">ORDER NOTES</div><div>${esc(d.notes)}</div>` : ''}
		<div class="dashed"></div>
		<div class="center muted">Packed by: ____________ &nbsp;&nbsp; Checked: ____________</div>
		</body></html>`
	);
	w.document.close();
	w.focus();
	w.print();
}

/** Print a refund / return receipt for an order. Mirrors the merchant's
 *  Receipt settings (paper size, header/footer, toggles) for consistency. */
export function printRefundReceipt(
	order: { data: Order },
	refund: Refund,
	opts: { currency?: string; cashier?: string } = {}
) {
	const d = order.data as any;
	const s = loadReceiptSettings();
	const currency = opts.currency ?? refund.currency ?? d.currency ?? 'USD';
	const width = s.paperSize === '58mm' ? 320 : 420;

	const itemsHtml = (refund.items ?? [])
		.map(
			(l) =>
				`<tr><td>${l.quantity}× ${esc(l.productName ?? 'Item')}</td><td class="right">${formatMoney(
					l.totalRefund ?? 0,
					currency
				)}</td></tr>`
		)
		.join('');

	const rows: string[] = [];
	if (s.showLogo && s.logoUrl)
		rows.push(
			`<div class="center"><img src="${esc(s.logoUrl)}" style="max-height:48px;object-fit:contain"/></div>`
		);
	if (s.showStoreName) rows.push(`<h2>${esc(s.storeName || 'Store')}</h2>`);
	rows.push('<div class="center"><strong>REFUND RECEIPT</strong></div>');
	rows.push('<div class="dashed"></div>');
	rows.push(
		`<table><tr><td>Date</td><td class="right">${new Date(refund.completedAt ?? Date.now()).toLocaleString()}</td></tr></table>`
	);
	rows.push(
		`<table><tr><td>Original order</td><td class="right">#${esc(orderNumber(d))}</td></tr></table>`
	);
	if (refund.reason)
		rows.push(
			`<table><tr><td>Reason</td><td class="right">${esc(refund.reason.replaceAll('_', ' '))}</td></tr></table>`
		);
	if (opts.cashier)
		rows.push(
			`<table><tr><td>Processed by</td><td class="right">${esc(opts.cashier)}</td></tr></table>`
		);
	rows.push('<div class="dashed"></div>');
	rows.push(`<table>${itemsHtml}</table>`);
	rows.push('<div class="dashed"></div>');
	rows.push(
		`<table><tr class="total"><td>REFUND TOTAL</td><td class="right">${formatMoney(
			refund.totalAmount ?? 0,
			currency
		)}</td></tr></table>`
	);
	rows.push(
		`<table><tr><td>Refund method</td><td class="right">${esc(refund.refundMethod ?? '—')}</td></tr></table>`
	);
	if (refund.note) rows.push(`<div class="center muted">${esc(refund.note)}</div>`);
	rows.push('<div class="dashed"></div>');
	if (s.footer) rows.push(`<div class="center muted">${esc(s.footer)}</div>`);

	const w = openWindow(width);
	if (!w) return;
	w.document.write(
		`<!doctype html><html><head><meta charset="utf-8"/><title>Refund ${esc(orderNumber(d))}</title><style>${BASE_STYLE}</style></head><body>${rows.join(
			''
		)}</body></html>`
	);
	w.document.close();
	w.focus();
	w.print();
}

/** Compose a customer-facing WhatsApp share link with order summary. */
export function buildWhatsAppLink(order: { data: Order }): string {
	const d = order.data as any;
	const phone = (d.shipping?.phone || d.pickup?.phone || '').replace(/[^\d]/g, '');
	const lines = (d.lines ?? []) as any[];
	const msg =
		`*${d.customerName ? 'Hi ' + d.customerName + '!' : 'Hello!'}*\n` +
		`Your order #${orderNumber(d)}:\n` +
		lines.map((l) => `• ${lineQty(l)}× ${lineName(l)}`).join('\n') +
		`\n*Total:* ${d.total ?? 0}\n` +
		(d.shipping?.trackingNumber ? `Tracking: ${d.shipping.trackingNumber}\n` : '') +
		`\nThank you!`;
	return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}` : '';
}
