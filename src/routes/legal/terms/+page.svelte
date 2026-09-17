<script lang="ts">
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { site } from '$lib/site';

	const effective = 'August 5, 2025';
</script>

<svelte:head><title>{t('legal.terms')} · {site.name}</title></svelte:head>

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

	<h2>Terms of Service</h2>

	<p class="text-[var(--ui-text)]">
		These Terms govern your use of <strong>{site.fullName}</strong> (“{site.name}”), the open-source
		point-of-sale and commerce application distributed under the {site.license} license. By using the
		software you accept these Terms.
	</p>

	<div class="not-prose my-6 rounded-xl border border-primary-500/30 bg-primary-500/5 p-4">
		<div class="flex items-start gap-3">
			<Icon name="lucide:scale" class="mt-0.5 size-5 shrink-0 text-primary-600 dark:text-primary-400" />
			<div class="text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
				<p class="font-semibold text-[var(--ui-text)]">The short version</p>
				<p class="mt-1">
					{site.name} is free, open-source software provided “as is.” You own your data and your
					keys. There is no central account, no hosted service guarantee, and no warranty — you are
					responsible for backing up your keys and your data.
				</p>
			</div>
		</div>
	</div>

	<h3>1. The software</h3>
	<p>
		{site.name} is provided to you as source code and built artifacts under the
		<strong>{site.license} License</strong> (see <a href={resolve('/legal/license')}>Open-source License</a>).
		You may run, study, modify, and redistribute it in accordance with that license. Nothing in these
		Terms restricts the rights granted to you by the {site.license} license.
	</p>

	<h3>2. Accounts &amp; keys</h3>
	<p>
		Your “account” is a Nostr cryptographic key pair that you control. {site.name} does not issue,
		store, or reset keys. You are solely responsible for:
	</p>
	<ul>
		<li>Keeping your private key (<code>nsec</code>) secret and backed up.</li>
		<li>All activity performed under your key, including by anyone you grant access to.</li>
		<li>The accuracy and legality of the business records you create.</li>
	</ul>
	<p>
		Because there is no recovery mechanism, losing your private key means losing the ability to sign
		new records as that identity.
	</p>

	<h3>3. Your data</h3>
	<p>
		You own your data. {site.name} stores records locally on your device and synchronizes them over
		Nostr relays you choose. The project provides <a href={resolve('/settings/data')}>export and wipe
		tools</a> and does not lock you in. See our <a href={resolve('/legal/privacy')}>Privacy Policy</a>
		for how data is handled.
	</p>

	<h3>4. Acceptable use</h3>
	<p>You agree not to use {site.name} to:</p>
	<ul>
		<li>Process, store, or publish unlawful, infringing, or fraudulent content;</li>
		<li>Operate in violation of applicable laws, including tax and financial-reporting obligations;</li>
		<li>Attempt to disrupt, overload, or gain unauthorized access to relays or third-party services;</li>
		<li>Distribute malware or use the software to harm others.</li>
	</ul>

	<h3>5. Third-party services</h3>
	<p>
		{site.name} integrates with services you configure yourself — Nostr relays, Lightning wallets,
		printers, and media storage providers. Each has its own terms and privacy practices. Your use of
		them is governed by those providers, not these Terms, and {site.name} is not responsible for
		their availability, security, or conduct.
	</p>

	<h3>6. No warranty</h3>
	<p>
		The software is licensed “as is” and “as available,” without warranty of any kind — express or
		implied — including warranties of merchantability, fitness for a particular purpose, or
		non-infringement. The entire risk as to the quality and performance of the software is with you.
	</p>

	<h3>7. Limitation of liability</h3>
	<p>
		To the maximum extent permitted by law, neither the authors, contributors, copyright holders, nor
		sponsor {site.sponsor.name} shall be liable for any direct, indirect, incidental, special,
		consequential, or punitive damages — including loss of profits, data, or business — arising out
		of your use of or inability to use the software, even if advised of the possibility of such
		damages. Point-of-sale and payment handling involves financial risk; you are responsible for
		reconciliation and backups.
	</p>

	<h3>8. Payments &amp; compliance</h3>
	<p>
		{site.name} can request and display payments, including over the Lightning Network, but it does
		not custody funds, move money, or act as a payment processor. You are responsible for complying
		with the tax, accounting, and regulatory requirements that apply to your business and
		jurisdiction.
	</p>

	<h3>9. Changes to these Terms</h3>
	<p>
		These Terms may be updated as the project evolves. Material changes will be reflected by bumping
		the “Effective” date and publishing the update on
		<a href={site.source.url} target="_blank" rel="noopener">GitHub</a>. Continued use after changes
		take effect constitutes acceptance.
	</p>

	<h3>10. Governing language</h3>
	<p>
		In the event of a discrepancy between the official English version of these Terms and a
		translation, the English version prevails.
	</p>

	<h3>11. Contact</h3>
	<p>
		For questions about these Terms, open an issue at
		<a href={site.source.issues} target="_blank" rel="noopener">{site.source.issues}</a> or visit
		<a href={site.website.url} target="_blank" rel="noopener">{site.website.url}</a>.
	</p>
</div>
