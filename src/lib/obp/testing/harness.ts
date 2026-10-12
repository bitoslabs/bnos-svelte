/**
 * Two-node pilot harness — the v0.1 interoperability proof.
 *
 * Creates two fully independent Business Nodes (separate stores, keys,
 * registries, policies) connected only by a loopback transport, exactly as
 * required by the go/no-go checks in `docs/OBP_SYSTEM_PLAN.md`: no shared
 * database, no calls into each other's internal APIs.
 */
import { generateSigningKey, type ObpSecretKey } from '../signature';
import {
	MemoryObpRegistry,
	type ObpKeyGrant,
	type ObpOrganization,
	type ObpRegistry
} from '../identity';
import { DefaultObpPolicy } from '../policy';
import { MemoryObpStores, type ObpStores } from '../node/store';
import { KvObpStores } from '../node/idb-store';
import { MemoryObpKv } from '../node/kv-store';
import {
	BusinessNode,
	SimulatedSettlementVerifier,
	type SettlementVerifier
} from '../node/business-node';
import { LoopbackNetwork, type ObpTransport } from '../node/transport';
import { bindNostrInbox, NostrTransport, type NostrInboxBinding } from '../node/nostr-transport';
import { MemoryRelayHub } from './memory-relay';

export interface PilotSigner {
	grantId: string;
	secretKey: ObpSecretKey;
	pubkey: string;
}

export interface PilotOrgKeys {
	owner: PilotSigner;
	staff: PilotSigner;
	agent: PilotSigner;
}

export interface PilotNode {
	node: BusinessNode;
	registry: ObpRegistry;
	keys: PilotOrgKeys;
}

export interface TwoNodePilot {
	buyer: PilotNode;
	seller: PilotNode;
	network: LoopbackNetwork;
	log: string[];
}

const STAFF_LIMIT_MINOR = 5_000_000;

function makeOrgKeys(prefix: string): PilotOrgKeys {
	const owner = generateSigningKey();
	const staff = generateSigningKey();
	const agent = generateSigningKey();
	return {
		owner: { grantId: `${prefix}:owner`, secretKey: owner.secretKey, pubkey: owner.pubkey },
		staff: { grantId: `${prefix}:staff`, secretKey: staff.secretKey, pubkey: staff.pubkey },
		agent: { grantId: `${prefix}:agent`, secretKey: agent.secretKey, pubkey: agent.pubkey }
	};
}

function makeGrants(orgId: string, keys: PilotOrgKeys): ObpKeyGrant[] {
	return [
		{
			grantId: keys.owner.grantId,
			orgId,
			pubkey: keys.owner.pubkey,
			role: 'owner',
			scope: { documentTypes: ['*'], actions: ['*'] }
		},
		{
			grantId: keys.staff.grantId,
			orgId,
			pubkey: keys.staff.pubkey,
			role: 'staff',
			scope: {
				documentTypes: ['*'],
				actions: ['*'],
				maxAmountMinor: STAFF_LIMIT_MINOR,
				currency: 'LAK',
				dailyLimitMinor: STAFF_LIMIT_MINOR
			}
		},
		{
			grantId: keys.agent.grantId,
			orgId,
			pubkey: keys.agent.pubkey,
			role: 'agent',
			scope: { documentTypes: ['rfq'], actions: ['issue'] }
		}
	];
}

function nodeFor(
	org: ObpOrganization,
	keys: PilotOrgKeys,
	counterparty: ObpOrganization,
	counterpartyKeys: PilotOrgKeys,
	transport: ObpTransport,
	bindInbound: (node: BusinessNode) => void,
	verifier: SettlementVerifier,
	now: () => Date,
	stores?: ObpStores
): PilotNode {
	// Each node trusts only itself and its preconfigured counterparty.
	const registry = new MemoryObpRegistry();
	registry.trustOrganization(org, makeGrants(org.orgId, keys));
	registry.trustOrganization(counterparty, makeGrants(counterparty.orgId, counterpartyKeys));

	const node = new BusinessNode({
		org,
		registry,
		stores: stores ?? new MemoryObpStores(),
		signers: new Map([
			[keys.owner.grantId, keys.owner.secretKey],
			[keys.staff.grantId, keys.staff.secretKey],
			[keys.agent.grantId, keys.agent.secretKey]
		]),
		transport,
		settlementVerifier: verifier,
		policy: new DefaultObpPolicy(),
		now
	});
	bindInbound(node);
	return { node, registry, keys };
}

/**
 * Wire up buyer and seller nodes over the loopback network. Settlement
 * outcome is injectable (`verified` by default) to exercise the
 * pending-payment and failed-settlement paths. An injectable clock makes
 * expiry rules (quotes, messages) deterministically testable.
 */
export function createTwoNodePilot(
	options: {
		settlementDecide?: (evidence: {
			settlement?: { externalId: string };
		}) => 'verified' | 'pending' | 'failed';
		now?: () => Date;
	} = {}
): TwoNodePilot {
	const buyerKeys = makeOrgKeys('buyer');
	const sellerKeys = makeOrgKeys('seller');
	const buyerOrg: ObpOrganization = {
		orgId: 'org:buyer',
		name: 'Buyer Co',
		ownerPubkey: buyerKeys.owner.pubkey
	};
	const sellerOrg: ObpOrganization = {
		orgId: 'org:seller',
		name: 'Seller Co',
		ownerPubkey: sellerKeys.owner.pubkey
	};

	const log: string[] = [];
	const network = new LoopbackNetwork(log);
	const verifier: SettlementVerifier = new SimulatedSettlementVerifier(
		options.settlementDecide ?? (() => 'verified')
	);
	const now = options.now ?? (() => new Date());

	return {
		buyer: nodeFor(
			buyerOrg,
			buyerKeys,
			sellerOrg,
			sellerKeys,
			network.transportFor(),
			(node) => network.serve(buyerOrg.orgId, node.bindTransportHandler()),
			verifier,
			now
		),
		seller: nodeFor(
			sellerOrg,
			sellerKeys,
			buyerOrg,
			buyerKeys,
			network.transportFor(),
			(node) => network.serve(sellerOrg.orgId, node.bindTransportHandler()),
			verifier,
			now
		),
		network,
		log
	};
}

export interface NostrPilot {
	buyer: PilotNode;
	seller: PilotNode;
	hub: MemoryRelayHub;
	/** Transport keys for decryption assertions in tests. */
	transportKeys: {
		buyer: { pubkey: string; secretKey: Uint8Array };
		seller: { pubkey: string; secretKey: Uint8Array };
	};
	/** Stop both inbox subscriptions. */
	close: () => void;
}

/**
 * Two independent nodes over the Nostr binding: NIP-44-encrypted
 * envelopes through an in-memory relay hub, with durable KV stores —
 * proving the same contract over the second transport binding.
 */
export function createNostrPilot(options: { now?: () => Date } = {}): NostrPilot {
	const buyerKeys = makeOrgKeys('buyer');
	const sellerKeys = makeOrgKeys('seller');
	const buyerOrg: ObpOrganization = {
		orgId: 'org:buyer',
		name: 'Buyer Co',
		ownerPubkey: buyerKeys.owner.pubkey
	};
	const sellerOrg: ObpOrganization = {
		orgId: 'org:seller',
		name: 'Seller Co',
		ownerPubkey: sellerKeys.owner.pubkey
	};

	const hub = new MemoryRelayHub();
	const buyerTransportKey = generateSigningKey();
	const sellerTransportKey = generateSigningKey();
	const directory: Record<string, string> = {
		[buyerOrg.orgId]: buyerTransportKey.pubkey,
		[sellerOrg.orgId]: sellerTransportKey.pubkey
	};
	const verifier = new SimulatedSettlementVerifier(() => 'verified');
	const now = options.now ?? (() => new Date());
	const bindings: NostrInboxBinding[] = [];

	const make = (
		org: ObpOrganization,
		keys: PilotOrgKeys,
		counterparty: ObpOrganization,
		counterpartyKeys: PilotOrgKeys,
		transportKey: { secretKey: Uint8Array }
	): PilotNode =>
		nodeFor(
			org,
			keys,
			counterparty,
			counterpartyKeys,
			new NostrTransport({
				client: hub,
				secretKey: transportKey.secretKey,
				resolveRecipientPubkey: (orgId) => directory[orgId]
			}),
			(node) => {
				bindings.push(bindNostrInbox(node, { client: hub, secretKey: transportKey.secretKey }));
			},
			verifier,
			now,
			new KvObpStores(new MemoryObpKv())
		);

	return {
		buyer: make(buyerOrg, buyerKeys, sellerOrg, sellerKeys, buyerTransportKey),
		seller: make(sellerOrg, sellerKeys, buyerOrg, buyerKeys, sellerTransportKey),
		hub,
		transportKeys: {
			buyer: { pubkey: buyerTransportKey.pubkey, secretKey: buyerTransportKey.secretKey },
			seller: { pubkey: sellerTransportKey.pubkey, secretKey: sellerTransportKey.secretKey }
		},
		close: () => bindings.forEach((b) => b.close())
	};
}

/** Deterministic clock for expiry tests. */
export class TestClock {
	constructor(private current: Date = new Date('2026-10-07T08:00:00Z')) {}
	now = (): Date => this.current;
	advance(ms: number): void {
		this.current = new Date(this.current.getTime() + ms);
	}
}

/** Wait for the loopback queue (micro-async) to drain. */
export async function settleDelivery(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 0));
}
