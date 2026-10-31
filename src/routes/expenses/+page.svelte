<script lang="ts">
	import { t } from '$lib/i18n/i18n.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import {
		TYPE,
		KIND,
		statusLabel,
		EXPENSE_CATEGORIES,
		type Expense,
		type ExpenseCategory,
		type ExpenseStatus
	} from '$lib/domain';
	import LedgerList from '$lib/components/finance/LedgerList.svelte';
	import {
		type LedgerConfig,
		readString,
		readNumber,
		isoToDateInput,
		dateInputToIso
	} from '$lib/components/finance/ledger';

	type PayMethod = 'cash' | 'bank' | 'card' | 'other';
	const STATUS_VALUES: ExpenseStatus[] = [
		'draft',
		'submitted',
		'approved',
		'paid',
		'pending',
		'cancelled'
	];

	const currency = $derived(tenant.state.currency);

	const config = $derived<LedgerConfig>({
		type: TYPE.expense,
		kind: KIND.expense,
		currency,
		numberPrefix: 'EXP',
		scope: 'expenses',
		emptyIcon: 'lucide:wallet',
		categories: EXPENSE_CATEGORIES.map((c) => ({ value: c.value, icon: c.icon })),
		methods: [
			{ value: 'cash', label: t('finance.methodCash') },
			{ value: 'bank', label: t('finance.methodBank') },
			{ value: 'card', label: t('finance.methodCard') },
			{ value: 'other', label: t('finance.methodOther') }
		],
		statuses: STATUS_VALUES.map((s) => ({ value: s, label: statusLabel(s) })),
		sign: '−',
		tone: 'error',
		labels: {
			title: t('nav.expenses'),
			subtitle: t('expenses.subtitle', { kind: KIND.expense }),
			totalOut: t('expenses.totalOut'),
			thisMonth: t('common.thisMonth'),
			entries: t('expenses.entries'),
			export: t('expenses.exportCsv'),
			add: t('common.add') + ' ' + t('common.expense'),
			edit: t('common.edit') + ' ' + t('common.expense'),
			save: t('common.save'),
			saveChanges: t('common.saveChanges'),
			cancel: t('common.cancel'),
			delete: t('common.delete'),
			duplicate: t('common.duplicate'),
			view: t('common.view'),
			viewRaw: t('common.viewRaw'),
			clear: t('common.clear'),
			searchPlaceholder: t('expenses.searchPlaceholder'),
			allCategories: t('expenses.allCategories'),
			allStatuses: t('expenses.allStatuses'),
			noDataTitle: t('expenses.noExpenses'),
			noDataDesc: t('expenses.noExpensesDesc'),
			noMatchTitle: t('expenses.noMatching'),
			noMatchDesc: t('common.tryDifferentSearch'),
			resetFilters: t('common.resetFilters'),
			description: t('common.description'),
			amount: t('common.amount'),
			category: t('common.category'),
			party: t('expenses.payee'),
			partyPlaceholder: t('expenses.payeePlaceholder'),
			method: t('common.method'),
			date: t('common.date'),
			status: t('common.status'),
			receiptUrl: t('expenses.receiptUrl'),
			receiptPlaceholder: t('expenses.receiptPlaceholder'),
			deleteTitle: t('expenses.deleteTitle'),
			deleteMsg: t('expenses.deleteMsg'),
			createdMsg: t('expenses.recorded'),
			updatedMsg: t('expenses.updated'),
			removedMsg: t('expenses.removed'),
			descRequiredMsg: t('expenses.descriptionRequired'),
			amountRequiredMsg: t('expenses.amountRequired'),
			rawDataTitle: t('expenses.rawData'),
			exportFilePrefix: 'expenses'
		},
		categoryLabel: (v) => t(`expense.category.${v}`),
		getParty: (d) => readString(d, 'payee'),
		getNumber: (d) => readString(d, 'number'),
		readValues: (d) => ({
			description: readString(d, 'description'),
			amount: readNumber(d),
			category: readString(d, 'category'),
			party: readString(d, 'payee'),
			method: readString(d, 'method') || 'cash',
			status: readString(d, 'status') || 'paid',
			reference: readString(d, 'reference'),
			occurredAt: isoToDateInput(readString(d, 'occurredAt'))
		}),
		buildData: (v, ctx): Expense => ({
			number: ctx.number,
			description: v.description,
			category: v.category as ExpenseCategory,
			amount: v.amount,
			currency: ctx.currency,
			payee: v.party || undefined,
			status: v.status as ExpenseStatus,
			method: v.method as PayMethod,
			reference: v.reference || undefined,
			occurredAt: dateInputToIso(v.occurredAt)
		})
	});
</script>

<svelte:head><title>{t('common.appName')} · {t('nav.expenses')}</title></svelte:head>

<LedgerList {config} />
