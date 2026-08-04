/**
 * Shared Bitcoin exchange-rate store — multi-currency, cache-first, CORS-safe.
 *
 * Why multi-currency
 * ------------------
 * A merchant's currency (THB, LAK, VND, …) is cached PER currency, so:
 *   • switching currency never discards a good rate (each is retained);
 *   • refreshing a page is instant when that currency was seen before — no
 *     network call, no "sats briefly missing";
 *   • a spurious pre-hydration fetch for the default 'USD' (before tenant
 *     loads the real currency) only fills the USD slot, never overwrites THB.
 *
 * Resilience
 * ----------
 * Rates derive as `BTC/{cur} = BTC/USD × USD→{cur}` using Coinbase (BTC/USD)
 * and open.er-api.com (FX) — both send `Access-Control-Allow-Origin: *` and
 * avoid CoinGecko's 429-on-browser-call behaviour (CoinGecko is fallback only).
 * Failures keep serving the last good cached rate and back off 2 min; concurrent
 * `ensureRate(cur)` calls share one in-flight request per currency.
 *
 * Native BTC/SATS convert exactly with no rate. Singleton (`btcRate`).
 */
import { browser } from '$app/environment';

const RATE_KEY = 'bnos-os:btc-rate';
const SETTINGS_KEY = 'bnos-os:settings-bitcoin';
const STALE_MS = 10 * 60 * 1000; // refresh a good rate after 10 min
const FAILURE_BACKOFF_MS = 2 * 60 * 1000; // don't retry a failed lookup for 2 min

/** Currencies that are already Bitcoin units — convert exactly, no FX needed. */
const NATIVE = ['BTC', 'SATS'];

interface RateEntry {
	rate: number;
	ts: number;
}
type RateMap = Record<string, RateEntry>;

interface CachedRates {
	rates?: RateMap;
	/** Legacy single-currency cache shape — migrated on load. */
	rate?: number;
	ts?: number;
	currency?: string;
}
interface BitcoinSettings {
	rateSource?: 'auto' | 'manual';
	manualRate?: number;
	receiptShowSats?: boolean;
}

async function fetchJson(url: string): Promise<unknown> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}

/** BTC spot price in USD. Coinbase first (CORS-safe, generous limits), CoinGecko fallback. */
async function fetchBtcUsd(): Promise<number> {
	try {
		const d = (await fetchJson('https://api.coinbase.com/v2/prices/BTC-USD/spot')) as {
			data?: { amount?: string };
		} | null;
		const n = d?.data?.amount ? parseFloat(d.data.amount) : NaN;
		if (Number.isFinite(n) && n > 0) return n;
	} catch {
		/* coingecko */
	}
	const d = (await fetchJson(
		'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'
	)) as { bitcoin?: { usd?: number } } | null;
	const v = d?.bitcoin?.usd;
	if (typeof v === 'number' && v > 0) return v;
	throw new Error('No BTC/USD rate');
}

/** USD → `currency` FX rate via open.er-api.com (covers LAK and all fiats). */
async function fetchUsdFx(currency: string): Promise<number> {
	const cur = currency.toUpperCase();
	if (cur === 'USD') return 1;
	const d = (await fetchJson('https://open.er-api.com/v6/latest/USD')) as {
		rates?: Record<string, number>;
	} | null;
	const r = d?.rates?.[cur];
	if (typeof r === 'number' && r > 0) return r;
	throw new Error(`No USD/${cur} FX rate`);
}

/** BTC spot price in `currency`, derived as BTC/USD × USD→{currency}. */
async function fetchBtcRate(currency: string): Promise<number> {
	const cur = currency.toUpperCase();
	const [btcUsd, fx] = await Promise.all([fetchBtcUsd(), fetchUsdFx(cur)]);
	const rate = btcUsd * fx;
	if (Number.isFinite(rate) && rate > 0) return rate;
	throw new Error(`No BTC/${currency} rate available`);
}

class BtcRateStore {
	/** Per-currency cache: { THB: {rate, ts}, LAK: {rate, ts}, … }. */
	rates = $state<RateMap>({});
	rateSource = $state<'auto' | 'manual'>('auto');
	manualRate = $state(0);
	/** Mirror of the "show sats on receipts" Bitcoin setting. */
	receiptShowSats = $state(false);
	loading = $state(false);
	error = $state('');

	/** Non-reactive bookkeeping for backoff + per-currency single-flight. */
	private lastErrorTs = 0;
	private inflight = new Map<string, Promise<boolean>>();

	constructor() {
		if (browser) this.load();
	}

	/** Re-read cache + settings from localStorage (without re-fetching). */
	load() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(RATE_KEY);
			if (raw) {
				const c = JSON.parse(raw) as CachedRates;
				const map: RateMap = { ...(c.rates ?? {}) };
				// Migrate legacy single-currency cache.
				if (typeof c.rate === 'number' && c.currency) {
					map[c.currency.toUpperCase()] ??= { rate: c.rate, ts: c.ts ?? 0 };
				}
				this.rates = map;
			}
		} catch {
			/* corrupt cache */
		}
		try {
			const sraw = localStorage.getItem(SETTINGS_KEY);
			if (sraw) {
				const s = JSON.parse(sraw) as BitcoinSettings;
				if (s.rateSource) this.rateSource = s.rateSource;
				if (s.manualRate !== undefined) this.manualRate = s.manualRate;
				if (s.receiptShowSats !== undefined) this.receiptShowSats = s.receiptShowSats;
			}
		} catch {
			/* corrupt settings */
		}
	}

	/** Effective BTC/fiat rate for `currency` (manual override is global). */
	rateFor(currency: string): number {
		if (this.rateSource === 'manual') return this.manualRate;
		return this.rates[currency.toUpperCase()]?.rate ?? 0;
	}
	/** True when we can convert `currency` to sats. */
	hasRate(currency = 'USD'): boolean {
		return this.rateFor(currency) > 0;
	}
	canConvert(currency: string): boolean {
		const c = currency.toUpperCase();
		if (NATIVE.includes(c)) return true;
		return this.rateFor(c) > 0;
	}

	/** Sats equivalent of an amount expressed in `currency`. */
	satsFromAmount(amount: number, currency: string): number {
		const c = currency.toUpperCase();
		if (c === 'SATS') return Math.round(amount);
		if (c === 'BTC') return Math.round(amount * 100_000_000);
		const r = this.rateFor(c);
		return r > 0 ? Math.round((Math.max(amount, 0) / r) * 100_000_000) : 0;
	}

	ageLabelFor(currency: string): string {
		const e = this.rates[currency.toUpperCase()];
		if (!e?.ts) return '';
		const mins = Math.floor((Date.now() - e.ts) / 60000);
		return mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
	}

	/** Fetch a fresh auto rate for `currency` and cache it. On failure the last
	 *  good cached rate is kept (sats stay visible) and an error is set. */
	refresh = async (currency: string): Promise<boolean> => {
		const c = currency.toUpperCase();
		if (NATIVE.includes(c)) return true;
		this.loading = true;
		this.error = '';
		try {
			const rate = await fetchBtcRate(currency);
			this.rates = { ...this.rates, [c]: { rate, ts: Date.now() } };
			if (browser) localStorage.setItem(RATE_KEY, JSON.stringify({ rates: this.rates }));
			return true;
		} catch (e) {
			this.error = (e as Error)?.message ?? 'Failed to fetch rate';
			this.lastErrorTs = Date.now();
			return false;
		} finally {
			this.loading = false;
		}
	};

	/** Ensure we have a usable rate for `currency`. Cache-first + per-currency
	 *  single-flight + failure backoff — a no-op once a fresh rate exists. */
	ensureRate = async (currency: string): Promise<void> => {
		const c = currency.toUpperCase();
		if (NATIVE.includes(c)) return;
		if (this.rateSource !== 'auto') return; // manual mode needs no fetch
		const existing = this.inflight.get(c);
		if (existing) {
			await existing; // share an in-flight fetch for this currency
			return;
		}
		const entry = this.rates[c];
		if (entry && Date.now() - entry.ts < STALE_MS) return; // fresh → nothing to do
		// Backoff if we've never obtained this currency and a recent attempt failed.
		if (!entry && Date.now() - this.lastErrorTs < FAILURE_BACKOFF_MS) return;
		const p = this.refresh(currency).finally(() => {
			this.inflight.delete(c);
		});
		this.inflight.set(c, p);
		await p;
	};
}

export const btcRate = new BtcRateStore();
