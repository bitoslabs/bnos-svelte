/**
 * Browser OBP node service — wires the transport-neutral BusinessNode
 * into the live BNOS app (migration stage 5 of the system plan).
 *
 * Identity model (v0.1 pilot):
 * - the node org is `org:<session-pubkey>`, self-sovereign and derivable
 *   by any counterparty that knows our key;
 * - the session key (nsec logins only — NIP-07 extensions cannot sign
 *   OBP canonical bytes) is both the owner grant and the NIP-44
 *   transport key;
 * - counterparties come from the GLO supplier directory: suppliers with
 *   a `pubkey` become trusted orgs `org:<their-pubkey>` with a derivable
 *   owner grant id `<orgId>:owner`, so both sides compute identical
 *   signer ids without any shared registry service;
 * - documents persist in IndexedDB (`KvObpStores`), settlement verifies
 *   locally via Lightning preimages;
 * - transport is Nostr (kind 21099) over the app's configured relays.
 *
 * Gated on the `obp` feature flag; fully inert while off.
 */
import { browser } from '$app/environment';
import { fromHex } from '$lib/obp';
import {
	BusinessNode,
	LightningPreimageVerifier,
	NostrTransport,
	SimplePoolNostrClient,
	bindNostrInbox,
	type NostrInboxBinding
} from '$lib/obp';
import { MemoryObpRegistry, type ObpOrganization } from '$lib/obp';
import { KvObpStores, createIdbKv } from '$lib/obp';
import { features } from '$lib/features.svelte';
import { session } from '$nostr/session.svelte';
import { relays } from '$nostr/relay.svelte';
import { glo } from '$nostr/store.svelte';
import { TYPE, type Supplier } from '$lib/domain';

export type ObpNodeStatus = 'off' | 'starting' | 'running' | 'needs-key' | 'error';

/** Deterministic org id for a Nostr pubkey. */
export const orgIdForPubkey = (pubkey: string): string => `org:${pubkey}`;
/** Deterministic owner grant id both parties can derive. */
export const ownerGrantIdFor = (orgId: string): string => `${orgId}:owner`;

class ObpNodeService {
	status = $state<ObpNodeStatus>('off');
	error = $state<string | null>(null);
	/** Counterparty orgs currently trusted (from the supplier directory). */
	counterparties = $state<ObpOrganization[]>([]);

	private nodeInstance: BusinessNode | null = null;
	private binding: NostrInboxBinding | null = null;
	/** orgId → transport pubkey, kept live by refreshCounterparties(). */
	private directory = new Map<string, string>();
	private registry = new MemoryObpRegistry();

	get node(): BusinessNode | null {
		return this.nodeInstance;
	}

	get canStart(): boolean {
		return (
			browser &&
			features.isEnabled('obp') &&
			session.isAuthenticated &&
			!!session.snapshot?.privateKeyHex
		);
	}

	/** Reasons the node cannot start, for the UI to explain. */
	get blockers(): string[] {
		const out: string[] = [];
		if (!session.isAuthenticated) out.push('Sign in to run your business node.');
		if (session.isAuthenticated && !session.snapshot?.privateKeyHex) {
			out.push('OBP signing needs an nsec login (NIP-07 extensions cannot sign OBP bytes).');
		}
		if (!relays.writableNormalized.length) out.push('Configure at least one relay.');
		return out;
	}

	/** Start the node with the current session and directory. */
	start = async (): Promise<void> => {
		if (!this.canStart || !session.snapshot?.privateKeyHex) {
			this.status = 'needs-key';
			return;
		}
		this.status = 'starting';
		this.error = null;
		try {
			const secretKey = fromHex(session.snapshot.privateKeyHex);
			const ourPubkey = session.pubkey!;
			const orgId = orgIdForPubkey(ourPubkey);
			const orgName = this.ownOrgName();

			this.registry = new MemoryObpRegistry();
			this.directory = new Map();
			this.registry.trustOrganization({ orgId, name: orgName, ownerPubkey: ourPubkey }, [
				{
					grantId: ownerGrantIdFor(orgId),
					orgId,
					pubkey: ourPubkey,
					role: 'owner',
					scope: { documentTypes: ['*'], actions: ['*'] }
				}
			]);
			this.refreshCounterparties();

			const relayClient = new SimplePoolNostrClient(relays.writableNormalized);
			this.nodeInstance = new BusinessNode({
				org: { orgId, name: orgName, ownerPubkey: ourPubkey },
				registry: this.registry,
				stores: new KvObpStores(createIdbKv()),
				signers: new Map([[ownerGrantIdFor(orgId), secretKey]]),
				transport: new NostrTransport({
					client: relayClient,
					secretKey,
					resolveRecipientPubkey: (orgId) => this.directory.get(orgId)
				}),
				settlementVerifier: new LightningPreimageVerifier()
			});
			this.binding = bindNostrInbox(this.nodeInstance, {
				client: relayClient,
				secretKey
			});
			this.status = 'running';
		} catch (e) {
			this.status = 'error';
			this.error = e instanceof Error ? e.message : String(e);
		}
	};

	stop = (): void => {
		this.binding?.close();
		this.binding = null;
		this.nodeInstance = null;
		this.status = 'off';
	};

	/**
	 * Re-seed counterparty trust from the supplier directory. Safe to call
	 * repeatedly; new suppliers become trusted immediately.
	 */
	refreshCounterparties = (): void => {
		if (!browser) return;
		const suppliers = glo.all<Supplier, typeof TYPE.supplier>(TYPE.supplier);
		const orgs: ObpOrganization[] = [];
		for (const s of suppliers) {
			const pubkey = s.data?.pubkey;
			if (!pubkey) continue;
			const orgId = orgIdForPubkey(pubkey);
			orgs.push({ orgId, name: s.data.name, ownerPubkey: pubkey });
			this.directory.set(orgId, pubkey);
			this.registry.trustOrganization({ orgId, name: s.data.name, ownerPubkey: pubkey }, [
				{
					grantId: ownerGrantIdFor(orgId),
					orgId,
					pubkey,
					role: 'owner',
					scope: { documentTypes: ['*'], actions: ['*'] }
				}
			]);
		}
		this.counterparties = orgs;
	};

	get ownSignerKeyId(): string | null {
		return session.pubkey ? ownerGrantIdFor(orgIdForPubkey(session.pubkey)) : null;
	}

	private ownOrgName(): string {
		if (!browser) return 'My Business';
		const org = glo.all<{ name?: string }, typeof TYPE.organization>(TYPE.organization)[0];
		return org?.data?.name?.trim() || 'My Business';
	}
}

export const obpNode = new ObpNodeService();
