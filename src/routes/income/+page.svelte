<script lang="ts">
	import { t } from '$lib/i18n/i18n.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import {
		TYPE,
		KIND,
		statusLabel,
		INCOME_CATEGORIES,
		type Income,
		type IncomeCategory,
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
		type: TYPE.income,
		kind: KIND.income,
		currency,
		numberPrefix: 'INC',
		scope: 'income',
		emptyIcon: 'lucide:hand-coins',
		categories: INCOME_CATEGORIES.map((c) => ({ value: c.value, icon: c.icon })),
		methods: [
			{ value: 'cash', label: t('finance.methodCash') },
			{ value: 'bank', label: t('finance.methodBank') },
			{ value: 'card', label: t('finance.methodCard') },
			{ value: 'other', label: t('finance.methodOther') }
		],
		statuses: STATUS_VALUES.map((s) => ({ value: s, label: statusLabel(s) })),
		sign: '+',
		tone: 'success',
		labels: {
			title: t('nav.income'),
			subtitle: t('income.subtitle', { kind: KIND.income }),
			totalOut: t('income.totalIn'),
			thisMonth: t('common.thisMonth'),
			entries: t('income.entries'),
			export: t('income.exportCsv'),
			add: t('common.add') + ' ' + t('common.income'),
			edit: t('common.edit') + ' ' + t('common.income'),
			save: t('common.save'),
			saveChanges: t('common.saveChanges'),
			cancel: t('common.cancel'),
			delete: t('common.delete'),
			view: t('common.view'),
			viewRaw: t('common.viewRaw'),
			clear: t('common.clear'),
			searchPlaceholder: t('income.searchPlaceholder'),
			allCategories: t('income.allCategories'),
			allStatuses: t('income.allStatuses'),
			noDataTitle: t('income.noIncome'),
			noDataDesc: t('income.noIncomeDesc'),
			noMatchTitle: t('income.noMatching'),
			noMatchDesc: t('common.tryDifferentSearch'),
			resetFilters: t('common.resetFilters'),
			description: t('common.description'),
			amount: t('common.amount'),
			category: t('common.category'),
			party: t('income.payer'),
			partyPlaceholder: t('income.payerPlaceholder'),
			method: t('common.method'),
			date: t('common.date'),
			status: t('common.status'),
			receiptUrl: t('income.receiptUrl'),
			receiptPlaceholder: t('income.receiptPlaceholder'),
			deleteTitle: t('income.deleteTitle'),
			deleteMsg: t('income.deleteMsg'),
			createdMsg: t('income.recorded'),
			updatedMsg: t('income.updated'),
			removedMsg: t('income.removed'),
			descRequiredMsg: t('income.descriptionRequired'),
			amountRequiredMsg: t('income.amountRequired'),
			rawDataTitle: t('income.rawData'),
			exportFilePrefix: 'income'
		},
		categoryLabel: (v) => t(`income.category.${v}`),
		getParty: (d) => readString(d, 'payer'),
		getNumber: (d) => readString(d, 'number'),
		readValues: (d) => ({
			description: readString(d, 'description'),
			amount: readNumber(d),
			category: readString(d, 'category'),
			party: readString(d, 'payer'),
			method: readString(d, 'method') || 'cash',
			status: readString(d, 'status') || 'paid',
			reference: readString(d, 'reference'),
			occurredAt: isoToDateInput(readString(d, 'occurredAt'))
		}),
		buildData: (v, ctx): Income => ({
			number: ctx.number,
			description: v.description,
			category: v.category as IncomeCategory,
			amount: v.amount,
			currency: ctx.currency,
			payer: v.party || undefined,
			status: v.status as ExpenseStatus,
			method: v.method as PayMethod,
			reference: v.reference || undefined,
			occurredAt: dateInputToIso(v.occurredAt)
		})
	});
</script>

<svelte:head><title>{t('common.appName')} · {t('nav.income')}</title></svelte:head>

<LedgerList {config} />
