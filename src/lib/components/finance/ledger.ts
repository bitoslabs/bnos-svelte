/**
 * Config contract for the shared finance ledger UI (`LedgerList.svelte`),
 * used by both the Expenses and Income pages. Each page supplies resolved i18n
 * strings, its category list, and accessors that map its domain entity to the
 * generic {@link LedgerValues} form model — so a single implementation drives
 * both ledgers without forking.
 */

export interface LedgerCategory {
	value: string;
	icon: string;
}

export interface LedgerOption {
	value: string;
	label: string;
}

/** Entity-agnostic form model. `occurredAt` is a `yyyy-mm-dd` input value. */
export interface LedgerValues {
	description: string;
	amount: number;
	category: string;
	party: string;
	method: string;
	status: string;
	reference: string;
	occurredAt: string;
}

export interface LedgerContext {
	currency: string;
	number: string;
}

export interface LedgerLabels {
	title: string;
	subtitle: string;
	totalOut: string;
	thisMonth: string;
	entries: string;
	export: string;
	add: string;
	edit: string;
	save: string;
	saveChanges: string;
	cancel: string;
	delete: string;
	view: string;
	viewRaw: string;
	clear: string;
	searchPlaceholder: string;
	allCategories: string;
	allStatuses: string;
	noDataTitle: string;
	noDataDesc: string;
	noMatchTitle: string;
	noMatchDesc: string;
	resetFilters: string;
	description: string;
	amount: string;
	category: string;
	party: string;
	partyPlaceholder: string;
	method: string;
	date: string;
	status: string;
	receiptUrl: string;
	receiptPlaceholder: string;
	deleteTitle: string;
	deleteMsg: string;
	createdMsg: string;
	updatedMsg: string;
	removedMsg: string;
	descRequiredMsg: string;
	amountRequiredMsg: string;
	rawDataTitle: string;
	exportFilePrefix: string;
}

export interface LedgerConfig {
	/** GLO object type (`TYPE.expense` / `TYPE.income`). */
	type: string;
	/** Resolved Nostr kind, shown in the subtitle. */
	kind: number;
	currency: string;
	/** Human-readable number prefix (EXP / INC). */
	numberPrefix: string;
	/** Sync scope name. */
	scope: string;
	/** Icon for the empty state. */
	emptyIcon: string;
	categories: LedgerCategory[];
	methods: LedgerOption[];
	statuses: LedgerOption[];
	/** Display sign + tone for the amount column. */
	sign: '−' | '+';
	tone: 'error' | 'success';
	labels: LedgerLabels;
	/** Resolve a category value to its localized label. */
	categoryLabel: (value: string) => string;
	/** Read the counterparty (payee / payer) from an entity payload. */
	getParty: (data: Record<string, unknown>) => string;
	/** Read the human-readable number from an entity payload. */
	getNumber: (data: Record<string, unknown>) => string;
	/** Map an entity payload into the editable form model. */
	readValues: (data: Record<string, unknown>) => LedgerValues;
	/** Map the form model into an entity payload (number supplied separately). */
	buildData: (values: LedgerValues, ctx: LedgerContext) => object;
}

/** Safe string read from an untyped entity payload. */
export function readString(data: Record<string, unknown>, key: string): string {
	const v = data[key];
	return typeof v === 'string' ? v : '';
}

/** Safe numeric read (defaults the `amount` field). */
export function readNumber(data: Record<string, unknown>, key = 'amount'): number {
	const n = Number(data[key]);
	return Number.isFinite(n) ? n : 0;
}

/** ISO timestamp → `yyyy-mm-dd` for a date input. */
export function isoToDateInput(iso: string): string {
	if (!iso) return '';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** `yyyy-mm-dd` date-input value → ISO timestamp (defaults to now). */
export function dateInputToIso(value: string): string {
	return value ? new Date(value).toISOString() : new Date().toISOString();
}
