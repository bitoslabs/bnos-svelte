/**
 * Centralized site / project metadata.
 *
 * Single source of truth for links that appear across the app (About page,
 * footer, legal pages, login). Edit values here and they propagate
 * everywhere.
 */

export const site = {
	name: 'BNOS',
	fullName: 'Bitcoin Network Operations System',
	tagline: 'Point-of-sale & commerce on Nostr · open source',
	version: '0.1.0',
	license: 'MIT',

	/** Marketing / product website. */
	website: {
		label: 'bnos.space',
		url: 'https://bnos.space'
	},

	/** Source code repository. */
	source: {
		label: 'bitoslabs/bnos-svelte',
		url: 'https://github.com/bitoslabs/bnos-svelte',
		issues: 'https://github.com/bitoslabs/bnos-svelte/issues',
		releases: 'https://github.com/bitoslabs/bnos-svelte/releases'
	},

	/** Sponsors / acknowledgments. */
	sponsor: {
		name: 'BitDigo',
		url: 'https://bitdigo.com'
	},

	/** Data standard powering the app. */
	core: {
		label: '@bitos/bnos-core',
		url: 'https://github.com/bitoslabs/bnos-core',
		standard: 'GLO v1 · Nostr'
	},

	/** Nostr / NIPs reference. */
	nostr: {
		nips: 'https://github.com/nostr-protocol/nips'
	}
} as const;

/** External links rendered on the About / legal pages. */
export const aboutLinks = [
	{
		label: 'Website',
		href: site.website.url,
		icon: 'lucide:globe',
		description: 'Learn about BNOS & the open ecosystem'
	},
	{
		label: 'Source code',
		href: site.source.url,
		icon: 'lucide:github',
		description: 'Self-host, audit, or contribute on GitHub'
	},
	{
		label: 'Report an issue',
		href: site.source.issues,
		icon: 'lucide:bug',
		description: 'Found a bug? Open an issue on GitHub'
	},
	{
		label: 'Releases',
		href: site.source.releases,
		icon: 'lucide:git-branch',
		description: 'Changelog & version history'
	}
] as const;
