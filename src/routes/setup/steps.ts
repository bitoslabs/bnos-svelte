/** Shared setup-step definition for the setup wizard stepper + pages. */

export interface SetupStep {
	slug: 'identity' | 'company' | 'branch' | 'relays' | 'catalog' | 'review' | 'done';
	label: string;
	icon: string;
	description: string;
}

export const setupSteps: SetupStep[] = [
	{ slug: 'identity', label: 'Identity', icon: 'lucide:fingerprint', description: 'Confirm your Nostr identity' },
	{ slug: 'company', label: 'Company', icon: 'lucide:building-2', description: 'Name your organization' },
	{ slug: 'branch', label: 'Branch', icon: 'lucide:map-pin', description: 'Set your primary location' },
	{ slug: 'relays', label: 'Relays', icon: 'lucide:radio', description: 'Choose Nostr relays' },
	{ slug: 'catalog', label: 'Catalog', icon: 'lucide:package', description: 'Seed your first products' },
	{ slug: 'review', label: 'Review', icon: 'lucide:clipboard-check', description: 'Confirm and create' },
	{ slug: 'done', label: 'Done', icon: 'lucide:party-popper', description: 'You are ready' }
];

export function stepIndex(slug: string): number {
	return setupSteps.findIndex((s) => s.slug === slug);
}
