<script lang="ts">
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { site } from '$lib/site';

	const effective = 'August 5, 2025';
</script>

<svelte:head><title>{t('legal.privacy')} · {site.name}</title></svelte:head>

<div class="prose prose-sm max-w-none dark:prose-invert
	prose-headings:font-display prose-headings:tracking-tight
	prose-headings:text-[var(--ui-text)] prose-p:text-[var(--ui-text-muted)]
	prose-li:text-[var(--ui-text-muted)] prose-strong:text-[var(--ui-text)]
	prose-a:text-primary-600 prose-a:no-underline hover:prose-a:underline dark:prose-a:text-primary-400
	prose-h3:text-[1.05rem] prose-h4:text-[0.95rem]">

	<div class="not-prose mb-6 flex items-center gap-2 text-[12px] text-[var(--ui-text-dimmed)]">
		<Icon name="lucide:calendar" class="size-3.5" />
		Effective <span class="font-semibold text-[var(--ui-text-muted)]">{effective}</span>
	</div>

	<h2>Privacy Policy</h2>

	<p class="text-[var(--ui-text)]">
		{site.fullName} (“{site.name}”) is a <strong>local-first, open-source</strong> point-of-sale
		and commerce application built on the Nostr protocol. This policy explains what data {site.name}
		holds, where it lives, and the choices you have over it.
	</p>

	<div class="not-prose my-6 rounded-xl border border-primary-500/30 bg-primary-500/5 p-4">
		<div class="flex items-start gap-3">
			<Icon name="lucide:shield-check" class="mt-0.5 size-5 shrink-0 text-primary-600 dark:text-primary-400" />
			<div class="text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
				<p class="font-semibold text-[var(--ui-text)]">The short version</p>
				<p class="mt-1">
					Your records live <strong>on your device first</strong>. Your private key never leaves
					your browser. We don't run a server that collects your business data, we don't track
					you, and we don't sell anything.
				</p>
			</div>
		</div>
	</div>

	<h3>1. How {site.name} stores data</h3>
	<p>
		{site.name} is local-first. Every product, order, customer, and shift you create is written to
		your browser's <code>localStorage</code> immediately, so the app keeps working offline. These
		records are <strong>GLO objects</strong> that follow the Nostr data standard from
		<code>{site.core.label}</code>.
	</p>
	<p>
		When you are online and signed in, those objects are <strong>signed with your Nostr key</strong>
		and published to the Nostr <em>relays</em> you have configured (by default a small set of public
		relays). Relays are independent servers — {site.name} does not operate them and does not control
		what they log. Think of relays as a decentralized sync backbone, not a database we own.
	</p>

	<h3>2. Your identity &amp; keys</h3>
	<p>
		Authentication uses Nostr cryptographic keys, not a username and password. You either sign in
		with a <strong>NIP-07 browser extension</strong> (e.g. Alby) or provide a
		<strong>private key (nsec)</strong>. In both cases your key is used <em>only inside your
		browser</em> to sign events locally — it is never transmitted to {site.name}, our website, or any
		server we run.
	</p>
	<ul>
		<li>If you generate a new identity, the key is created on your device and shown to you once.</li>
		<li>If you lose your private key, <strong>no one can recover it</strong> — there is no password-reset server by design.</li>
		<li>Your public key (<code>npub</code>) is published openly so other clients can find and verify your records.</li>
	</ul>

	<h3>3. Payload encryption</h3>
	<p>
		By default, records are published to relays in plaintext (the GLO JSON, signed). You can switch on
		<strong>payload encryption</strong> in <a href={resolve('/settings')}>Settings → Security</a>,
		which encrypts the contents of orders, payments, customers, shifts and staff records using
		<strong>AES-256-GCM</strong> before they ever leave your device. Access is shared with your team
		through NIP-44 organization key grants.
	</p>

	<h3>4. Media uploads</h3>
	<p>
		If you upload images (product photos, logos, receipts), {site.name} can store them either with a
		storage account <strong>you configure yourself</strong> (Cloudinary, S3, Nostr media servers) or,
		optionally, through a community media relay. The media destination is chosen in
		<a href={resolve('/settings/media')}>Settings → Media &amp; uploads</a>. If you self-host, those
		uploads never touch infrastructure controlled by the project.
	</p>

	<h3>5. Analytics &amp; tracking</h3>
	<p>
		{site.name} does <strong>not</strong> include analytics, advertising, or third-party trackers.
		There are no cookies set for tracking, no fingerprints collected, and no “phone-home” telemetry.
		Your relay operators may log connection metadata as part of running a relay — that is outside
		{site.name}'s control.
	</p>

	<h3>6. Your choices</h3>
	<ul>
		<li><strong>Export</strong> all of your local data as a JSON backup at any time from <a href={resolve('/settings/data')}>Settings → Data → Export backup</a>.</li>
		<li><strong>Wipe</strong> every record from this device (and sign out) from the same page. This only affects this device; records already published to relays remain there until they expire or you delete them.</li>
		<li><strong>Switch relays</strong> in <a href={resolve('/settings/relays')}>Settings → Relays</a> to choose exactly which servers receive your data.</li>
		<li><strong>Review the source</strong> — because {site.name} is open source under the {site.license} license, every claim in this policy is auditable at <a href={site.source.url} target="_blank" rel="noopener">{site.source.url}</a>.</li>
	</ul>

	<h3>7. Children's privacy</h3>
	<p>
		{site.name} is a business tool and is not directed at individuals under the age required to enter
		into contracts in their jurisdiction. We do not knowingly collect personal information from
		children through the application.
	</p>

	<h3>8. Changes to this policy</h3>
	<p>
		If we materially change how {site.name} handles data, we will update this page and bump the
		“Effective” date above. Because the app is versioned and open source, you can always review the
		policy that shipped with your installed version on
		<a href={site.source.url} target="_blank" rel="noopener">GitHub</a>.
	</p>

	<h3>9. Contact</h3>
	<p>
		Questions about privacy? Open a discussion on
		<a href={site.source.issues} target="_blank" rel="noopener">GitHub Issues</a>, or visit
		<a href={site.website.url} target="_blank" rel="noopener">{site.website.url}</a> for project-wide
		contact details.
	</p>
</div>
