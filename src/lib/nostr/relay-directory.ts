/**
 * Curated directory of well-known Nostr relays surfaced by the
 * "Recommended relays" picker on the relays settings page (and reusable in the
 * setup wizard / login flow).
 *
 * This is *static* metadata (friendly name, region, tier, focus) — live
 * reachability and latency are probed at runtime via `testRelay()`. URLs are
 * kept canonical (`wss://`, no trailing slash) so they match the relay store's
 * normalization and dedupe cleanly against already-added relays.
 *
 * Keep the list intentionally short, reliable and diverse across regions. Paid
 * relays are labeled as such and skipped during latency probing (they require
 * NIP-42 auth and would otherwise report a misleading "failed" status).
 */
export type RelayRegion = 'global' | 'eu' | 'us' | 'asia';
export type RelayTier = 'free' | 'paid';
export type RelayKind = 'general' | 'index' | 'fast' | 'community';

export interface DirectoryRelay {
	/** Canonical relay URL (wss://, no trailing slash). */
	url: string;
	/** Friendly, human-readable name. */
	name: string;
	/** Short marketing-free tagline describing the relay's strength. */
	description: string;
	/** Geographic hint, used for filtering and latency expectations. */
	region: RelayRegion;
	/** Whether the relay is free or requires payment/auth. */
	tier: RelayTier;
	/** Primary role / strength. */
	kind: RelayKind;
}

export const RELAY_DIRECTORY: DirectoryRelay[] = [
	{
		url: 'wss://relay.damus.io',
		name: 'Damus',
		description: 'Official Damus relay — fast, reliable and widely used.',
		region: 'global',
		tier: 'free',
		kind: 'general'
	},
	{
		url: 'wss://relay.primal.net',
		name: 'Primal',
		description: 'Primal cache layer — extremely fast reads for large feeds.',
		region: 'global',
		tier: 'free',
		kind: 'fast'
	},
	{
		url: 'wss://relay.nostr.band',
		name: 'Nostr.band',
		description: 'Global indexer — best for search, discovery and archival.',
		region: 'global',
		tier: 'free',
		kind: 'index'
	},
	{
		url: 'wss://nos.lol',
		name: 'nos.lol',
		description: 'Operated by Nos.social — well-moderated and dependable.',
		region: 'us',
		tier: 'free',
		kind: 'general'
	},
	{
		url: 'wss://relay.snort.social',
		name: 'Snort',
		description: "Snort's relay — solid reach across Europe.",
		region: 'eu',
		tier: 'free',
		kind: 'general'
	},
	{
		url: 'wss://relay.nsec.app',
		name: 'nsec.app',
		description: 'European relay operated by nsec.bet.',
		region: 'eu',
		tier: 'free',
		kind: 'general'
	},
	{
		url: 'wss://nostr.mom',
		name: 'nostr.mom',
		description: 'Generous-limits community relay with good uptime.',
		region: 'global',
		tier: 'free',
		kind: 'community'
	},
	{
		url: 'wss://welcome.nostr.wine',
		name: 'Nostr Wine · welcome',
		description: 'Free gateway into the curated Nostr Wine network.',
		region: 'global',
		tier: 'free',
		kind: 'general'
	},
	{
		url: 'wss://relay.bitcoiner.social',
		name: 'Bitcoiner.social',
		description: 'Bitcoin-focused community relay.',
		region: 'global',
		tier: 'free',
		kind: 'community'
	},
	{
		url: 'wss://nostr.cercatrova.me',
		name: 'Cercatrova',
		description: 'European relay with broad event reach.',
		region: 'eu',
		tier: 'free',
		kind: 'general'
	},
	{
		url: 'wss://paid.nostr.wine',
		name: 'Nostr Wine · paid',
		description: 'Premium, auth-required relay — highest quality, fewer restrictions.',
		region: 'global',
		tier: 'paid',
		kind: 'general'
	}
];

/** Regions available in the directory (for filter controls). */
export const RELAY_REGIONS: RelayRegion[] = ['global', 'eu', 'us', 'asia'];
