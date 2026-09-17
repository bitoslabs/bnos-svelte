/**
 * Resolve the Lightning invoice memo (description) for a sale.
 *
 * Precedence:
 *   1. Cashier's typed memo (POS "Invoice description / memo" field)
 *   2. Settings → Bitcoin "Default memo" (brand line, e.g. "Café BNOS · Vientiane")
 *   3. Sale context (customer name, else the item list, else "BNOS sale")
 *
 * Every provider attaches the memo to the BOLT11 description: Blink
 * (`LnInvoiceCreateInput.memo`), NWC (`description`), Alby/Strike/PhoenixD
 * (`description`), LND (`memo`), LNURL-pay (`comment` when allowed).
 */

/** The untouched default label in Settings → Bitcoin — treat as "not set". */
const SETTINGS_PLACEHOLDER_MEMO = 'payment';

/** BOLT11 description hash safety: keep memos short. */
export const MEMO_MAX = 120;

export interface InvoiceMemoInput {
	/** Cashier-typed memo from the POS tender block. */
	cashierMemo?: string;
	/** Persisted default memo (Settings → Bitcoin → Payment settings). */
	settingsMemo?: string;
	/** Customer name attached to the cart, if any. */
	customerName?: string;
	/** Cart lines (name + quantity). */
	items?: { name: string; quantity: number }[];
}

export function resolveInvoiceMemo(input: InvoiceMemoInput): string {
	const cashier = input.cashierMemo?.trim();
	if (cashier) return cashier.slice(0, MEMO_MAX);

	const settings = input.settingsMemo?.trim();
	if (settings && settings.toLowerCase() !== SETTINGS_PLACEHOLDER_MEMO) {
		return settings.slice(0, MEMO_MAX);
	}

	const items = (input.items ?? [])
		.map((l) => `${l.name}${l.quantity > 1 ? ` × ${l.quantity}` : ''}`)
		.join(', ');
	return (input.customerName ? `Sale for ${input.customerName}` : items || 'BNOS sale').slice(
		0,
		MEMO_MAX
	);
}
