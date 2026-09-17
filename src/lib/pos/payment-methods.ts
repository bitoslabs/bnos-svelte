/**
 * Payment-method accent palette — shared by the success celebration surfaces
 * (POS receipt header + customer-display overlay). Keeping it in a plain module
 * (not a `.svelte` file) so any component can import it without coupling.
 */

export type MethodMeta = {
	label: string;
	icon: string;
	/** Solid accent — success badge ring, confetti, chip text. */
	accent: string;
	/** Soft rgba glow behind the badge. */
	glow: string;
};

const PALETTE: Record<string, MethodMeta> = {
	cash: { label: 'Cash', icon: 'lucide:banknote', accent: '#16a34a', glow: 'rgba(34,197,94,.35)' },
	card: {
		label: 'Card',
		icon: 'lucide:credit-card',
		accent: '#2563eb',
		glow: 'rgba(59,130,246,.35)'
	},
	qr: { label: 'QR Pay', icon: 'lucide:qr-code', accent: '#7c3aed', glow: 'rgba(139,92,246,.35)' },
	lightning: {
		label: 'Lightning',
		icon: 'lucide:zap',
		accent: '#d97706',
		glow: 'rgba(245,158,11,.4)'
	}
};

const FALLBACK: MethodMeta = {
	label: '',
	icon: 'lucide:wallet',
	accent: '#16a34a',
	glow: 'rgba(34,197,94,.35)'
};

export function methodMetaFor(method: string): MethodMeta {
	return PALETTE[method] ?? { ...FALLBACK, label: method };
}
