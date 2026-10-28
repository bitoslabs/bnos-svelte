/**
 * NIP-46 remote signer ("bunker") support.
 *
 * The user's private key never reaches this app. A disposable client keypair
 * talks NIP-44-encrypted JSON-RPC to the remote signer over kind 24133 events.
 * Two connection flows are supported, mirroring bitos.space:
 *
 *  - **Bunker-initiated** — the user pastes a `bunker://` URL (or a NIP-05
 *    identifier that resolves to one).
 *  - **Client-initiated** — we generate a `nostrconnect://` URI, show it as a
 *    QR code, and wait for a signer app to approve it.
 *
 * The connection (bunker pointer + disposable client secret) is persisted by
 * the session store so a reload can restore the session without re-approval.
 */
import { generateSecretKey, getPublicKey, type EventTemplate, type Event } from 'nostr-tools/pure';
import {
	BunkerSigner,
	createNostrConnectURI,
	parseBunkerInput,
	type BunkerPointer
} from 'nostr-tools/nip46';
import { SimplePool } from 'nostr-tools/pool';
import { site } from '$lib/site';

/** Everything needed to rebuild a NIP-46 session after a reload. */
export interface Nip46Connection {
	bunker: BunkerPointer;
	/** Hex-encoded disposable client secret key. */
	clientSecretKey: string;
	/** Hex-encoded user (signer) public key. */
	userPubkey: string;
}

export interface Nip46ConnectOptions {
	pool?: SimplePool;
	/** Called when the signer asks the user to approve in another window. */
	onAuth?: (url: string) => void;
}

const CLIENT_METADATA = {
	name: site.name,
	url: site.website.url
};

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function hexToBytes(hex: string): Uint8Array {
	if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('Invalid NIP-46 client key.');
	const out = new Uint8Array(32);
	for (let i = 0; i < 32; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

function randomHex(bytes = 16): string {
	const data = new Uint8Array(bytes);
	crypto.getRandomValues(data);
	return bytesToHex(data);
}

/** A signer backed by a remote NIP-46 bunker. */
export class Nip46Signer {
	readonly kind = 'nip46' as const;

	constructor(
		private readonly bunker: BunkerSigner,
		readonly connection: Nip46Connection
	) {}

	getPublicKey(): Promise<string> {
		return Promise.resolve(this.connection.userPubkey);
	}

	signEvent(template: EventTemplate): Promise<Event> {
		return this.bunker.signEvent(template);
	}

	nip44Encrypt(peerHex: string, plaintext: string): Promise<string> {
		return this.bunker.nip44Encrypt(peerHex, plaintext);
	}

	nip44Decrypt(peerHex: string, ciphertext: string): Promise<string> {
		return this.bunker.nip44Decrypt(peerHex, ciphertext);
	}

	/**
	 * Verify the remote signer still accepts requests.
	 *
	 * Returns:
	 *  - `'ok'`       — the signer answered `pong`.
	 *  - `'rejected'` — the signer answered with an error (definite revocation).
	 *  - `'timeout'`  — no answer within `timeoutMs` (could be a relay hiccup).
	 *
	 * `BunkerSigner.ping()` has no built-in timeout, so the race is required;
	 * the caller closes the signer on a final failure to release the pending
	 * request and its relay subscription.
	 */
	async checkConnection(timeoutMs = 4000): Promise<'ok' | 'timeout' | 'rejected'> {
		let timedOut = false;
		try {
			await Promise.race([
				this.bunker.ping(),
				new Promise<never>((_, reject) => {
					setTimeout(() => {
						timedOut = true;
						reject(new Error('Remote signer did not respond'));
					}, timeoutMs);
				})
			]);
			return 'ok';
		} catch {
			return timedOut ? 'timeout' : 'rejected';
		}
	}

	async close(): Promise<void> {
		await this.bunker.close();
	}
}

/** Rebuild a signer from a persisted connection (no re-approval needed). */
export function restoreNip46Signer(
	connection: Nip46Connection,
	options: Nip46ConnectOptions = {}
): Nip46Signer {
	const bunker = BunkerSigner.fromBunker(
		hexToBytes(connection.clientSecretKey),
		connection.bunker,
		{
			pool: options.pool,
			onauth: options.onAuth
		}
	);
	return new Nip46Signer(bunker, connection);
}

/**
 * Bunker-initiated login: parse a `bunker://` URL (or NIP-05), connect, and
 * return a ready signer plus the connection to persist.
 */
export async function connectWithBunker(
	input: string,
	options: Nip46ConnectOptions = {}
): Promise<Nip46Signer> {
	const bunkerPointer = await parseBunkerInput(input.trim());
	if (!bunkerPointer) {
		throw new Error('That is not a valid bunker:// URL or NIP-05 identifier.');
	}

	const clientSecretKey = generateSecretKey();
	const bunker = BunkerSigner.fromBunker(clientSecretKey, bunkerPointer, {
		pool: options.pool,
		onauth: options.onAuth
	});

	try {
		await bunker.connect(CLIENT_METADATA);
		const userPubkey = (await bunker.getPublicKey()).toLowerCase();
		const connection: Nip46Connection = {
			bunker: bunker.bp,
			clientSecretKey: bytesToHex(clientSecretKey),
			userPubkey
		};
		return new Nip46Signer(bunker, connection);
	} catch (error) {
		await bunker.close();
		throw error;
	}
}

/**
 * Client-initiated login: generate a `nostrconnect://` URI, hand it to the UI
 * (QR code / link), and resolve once a signer app approves it.
 */
export async function connectWithNostrConnect(input: {
	relays: string[];
	onUri: (uri: string) => void;
	signal?: AbortSignal;
	options?: Nip46ConnectOptions;
}): Promise<Nip46Signer> {
	const relays = input.relays.filter(Boolean);
	if (!relays.length) throw new Error('Add at least one relay before connecting a signer app.');

	const clientSecretKey = generateSecretKey();
	const clientPubkey = getPublicKey(clientSecretKey);
	const secret = randomHex(16);
	const uri = createNostrConnectURI({
		clientPubkey,
		relays,
		secret,
		...CLIENT_METADATA
	});

	input.onUri(uri);

	const bunker = await BunkerSigner.fromURI(
		clientSecretKey,
		uri,
		{ pool: input.options?.pool, onauth: input.options?.onAuth },
		input.signal ?? 180_000
	);

	const userPubkey = (await bunker.getPublicKey()).toLowerCase();
	const connection: Nip46Connection = {
		bunker: bunker.bp,
		clientSecretKey: bytesToHex(clientSecretKey),
		userPubkey
	};
	return new Nip46Signer(bunker, connection);
}
