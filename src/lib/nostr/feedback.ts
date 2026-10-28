/**
 * Encrypted user feedback — bug reports and feature requests to the owner.
 *
 * Sent as NIP-17 private direct messages (kind-14 rumor → kind-13 seal →
 * kind-1059 gift wrap), so reports stay private, leak no metadata, and render
 * as a normal message in modern clients rather than the deprecated kind-4
 * "legacy" DM.
 *
 * Recipients come from `ownerAllowList()` (env `PUBLIC_OWNER_NPUBS` + the keys
 * trusted on this device in Settings → Notifications), falling back to the
 * project support npub in `site.support`. One gift wrap is published per
 * recipient to that recipient's NIP-17 inbox relays (kind 10050) when known,
 * otherwise to the app's configured relays as a best effort. The inner message
 * body is human-readable plain text with a compact footer, and the rumor is
 * tagged `["t","bnos-feedback"]` + the category so the owner can classify it.
 */
import { publishToRelays, type NostrEvent } from '@bitos/bnos-core';
import { fetchEvents, sendEvent } from './client';
import { session } from './session.svelte';
import { ownerAllowList, toHexPubkey } from './owner-feed.svelte';
import { buildGiftWrap } from '$lib/crypto/nip17';
import { SUPPORT_NPUB, site } from '$lib/site';

/** NIP-17 inbox relays advertised by a user (kind 10050). */
const KIND_DM_RELAYS = 10050;

/** Feedback category, mirrored as a `t` tag for filtering. */
export type FeedbackCategory = 'bug' | 'feature' | 'other';

/** Stable tag that marks an event as BNOS user feedback. */
export const FEEDBACK_TAG = 'bnos-feedback';

export interface FeedbackInput {
	category: FeedbackCategory;
	message: string;
	/** Optional reply-to (npub, email, Lightning address…). */
	contact?: string;
	/** Route the report originated from, e.g. `/pos`. */
	route?: string;
	/** Optional uploaded attachment (screenshot / log / file). */
	attachment?: FeedbackAttachment;
}

/** An uploaded file referenced by a feedback message. */
export interface FeedbackAttachment {
	url: string;
	kind: 'image' | 'video' | 'file';
	mimeType: string;
	bytes: number;
	name?: string;
}

/** Human-readable label for the category footer (tags carry the raw token). */
const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
	bug: 'Bug report',
	feature: 'Feature request',
	other: 'Feedback'
};

export type FeedbackResult =
	| { ok: true; recipients: number }
	| {
			ok: false;
			reason: 'not-authenticated' | 'empty' | 'no-recipient' | 'encrypt-failed' | 'publish-failed';
	  };

/**
 * Owner pubkeys (hex) that should receive feedback. Uses the trusted owner
 * allow-list, falling back to the project support npub when none is configured.
 */
export function feedbackRecipients(): string[] {
	const owners = ownerAllowList();
	if (owners.length) return owners;
	const support = toHexPubkey(SUPPORT_NPUB);
	return support ? [support] : [];
}

/** A recipient's NIP-17 inbox relays (kind 10050), newest event wins. */
async function recipientInboxRelays(pubkey: string): Promise<string[]> {
	const events = await fetchEvents({ kinds: [KIND_DM_RELAYS], authors: [pubkey] });
	if (!events.length) return [];
	let latest = events[0]!;
	for (const event of events) {
		if (event.created_at > latest.created_at) latest = event;
	}
	const urls = new Set<string>();
	for (const tag of latest.tags) {
		if (tag[0] === 'relay' && typeof tag[1] === 'string' && tag[1].startsWith('wss://')) {
			urls.add(tag[1]);
		}
	}
	return [...urls];
}

/**
 * Encrypt + publish a feedback message to every configured owner. Resolves
 * `ok: true` when at least one relay accepted at least one recipient's event.
 * Never throws — transport and encryption failures are reported as a reason.
 */
export async function sendFeedback(input: FeedbackInput): Promise<FeedbackResult> {
	const snap = session.snapshot;
	if (!snap?.pubkey) return { ok: false, reason: 'not-authenticated' };

	const message = input.message.trim();
	if (!message) return { ok: false, reason: 'empty' };

	const recipients = feedbackRecipients();
	if (!recipients.length) return { ok: false, reason: 'no-recipient' };

	const contact = input.contact?.trim();

	// Readable plain text so any client renders the report cleanly.
	const parts = [message];
	const extras: string[] = [];
	if (contact) extras.push(`Contact: ${contact}`);
	if (input.attachment) extras.push(`Attachment: ${input.attachment.url}`);
	if (extras.length) parts.push(extras.join('\n'));
	const meta = [`BNOS v${site.version}`, CATEGORY_LABEL[input.category]];
	if (input.route) meta.push(input.route);
	if (snap.npub) meta.push(snap.npub);
	parts.push(`— ${meta.join(' · ')}`);
	const text = parts.join('\n\n');

	// Build one gift wrap per recipient (encrypt + sign).
	const wraps: { recipient: string; event: NostrEvent }[] = [];
	try {
		for (const recipient of recipients) {
			const event = await buildGiftWrap({
				senderPubkey: snap.pubkey,
				recipientPubkey: recipient,
				content: text,
				tags: [
					['t', FEEDBACK_TAG],
					['t', input.category]
				],
				loginMethod: snap.loginMethod,
				nsec: snap.nsec,
				extensionSigner: session.extensionSigner ?? undefined,
				signer: session.activeSigner ?? undefined
			});
			wraps.push({ recipient, event });
		}
	} catch {
		return { ok: false, reason: 'encrypt-failed' };
	}

	// Publish each wrap to the recipient's NIP-17 inbox relays when known,
	// falling back to the configured relays as a best effort.
	const results = await Promise.allSettled(
		wraps.map(async ({ recipient, event }) => {
			const inbox = await recipientInboxRelays(recipient);
			return inbox.length ? publishToRelays(event, inbox) : sendEvent(event);
		})
	);

	const delivered = results.filter((r) => r.status === 'fulfilled' && r.value).length;
	if (delivered > 0) return { ok: true, recipients: delivered };
	return { ok: false, reason: 'publish-failed' };
}
