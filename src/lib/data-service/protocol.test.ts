import { describe, expect, it } from 'vitest';
import {
	DATA_SERVICE_AUTH_KIND,
	DataServiceError,
	buildAuthEventTemplate,
	normalizeServiceUrl,
	parseCapabilities,
	parseChallenge,
	parseIngestResult,
	parseSession,
	parseStatus,
	serviceEndpoint
} from './protocol';

const capabilities = {
	protocol: 1,
	service: { id: 'svc_1', name: 'Test service' },
	auth: { challenge: 'nostr-event', kind: 27235, audience: 'https://service.example' },
	capabilities: { backup: true, status: true, reporting: false, restoreStatus: true }
};

describe('service URL validation', () => {
	it('accepts HTTPS and trims a trailing slash', () => {
		expect(normalizeServiceUrl(' https://service.example/ ')).toBe('https://service.example');
	});

	it('preserves a path prefix', () => {
		expect(normalizeServiceUrl('https://service.example/bnos/')).toBe(
			'https://service.example/bnos'
		);
	});

	it('allows HTTP only on loopback', () => {
		expect(normalizeServiceUrl('http://localhost:8787')).toBe('http://localhost:8787');
		expect(normalizeServiceUrl('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
		expect(() => normalizeServiceUrl('http://service.example')).toThrow(DataServiceError);
	});

	it('rejects credentials, query strings, fragments and non-HTTP schemes', () => {
		expect(() => normalizeServiceUrl('https://user:pass@service.example')).toThrow(
			DataServiceError
		);
		expect(() => normalizeServiceUrl('https://service.example/?invite=secret')).toThrow(
			DataServiceError
		);
		expect(() => normalizeServiceUrl('https://service.example/#frag')).toThrow(DataServiceError);
		expect(() => normalizeServiceUrl('ftp://service.example')).toThrow(DataServiceError);
		expect(() => normalizeServiceUrl('not a url')).toThrow(DataServiceError);
	});

	it('resolves protocol paths against the base path', () => {
		expect(serviceEndpoint('https://service.example', 'v1/status')).toBe(
			'https://service.example/v1/status'
		);
		expect(serviceEndpoint('https://service.example/bnos', 'v1/status')).toBe(
			'https://service.example/bnos/v1/status'
		);
	});
});

describe('capability validation', () => {
	it('parses a compatible service', () => {
		const parsed = parseCapabilities(capabilities);
		expect(parsed.service.id).toBe('svc_1');
		expect(parsed.capabilities.backup).toBe(true);
		expect(parsed.capabilities.reporting).toBe(false);
	});

	it('rejects another protocol version', () => {
		expect(() => parseCapabilities({ ...capabilities, protocol: 2 })).toThrow(
			/incompatible|Unsupported protocol/
		);
	});

	it('rejects a non-Nostr auth challenge', () => {
		expect(() =>
			parseCapabilities({
				...capabilities,
				auth: { ...capabilities.auth, challenge: 'password' }
			})
		).toThrow(DataServiceError);
	});
});

describe('challenge and session validation', () => {
	const now = 1_700_000_000_000;
	const challenge = {
		challengeId: 'ch_1',
		nonce: 'nonce',
		audience: 'https://service.example',
		expiresAt: 1_700_000_060,
		serviceId: 'svc_1'
	};

	it('parses an unexpired challenge', () => {
		const parsed = parseChallenge(challenge, now);
		expect(parsed.challengeId).toBe('ch_1');
		expect(parsed.kind).toBe(DATA_SERVICE_AUTH_KIND);
	});

	it('rejects an expired challenge', () => {
		expect(() => parseChallenge({ ...challenge, expiresAt: 1_699_999_999 }, now)).toThrow(
			DataServiceError
		);
	});

	it('binds the session to the active identity and workspace', () => {
		const session = {
			token: 'token',
			expiresAt: 1_700_000_900,
			user: { pubkey: 'ABC' },
			workspace: { id: 'org_1', name: 'Shop' },
			permissions: ['settings:write']
		};
		const parsed = parseSession(session, { pubkey: 'abc', workspaceId: 'org_1' }, now);
		expect(parsed.user.pubkey).toBe('abc');

		const withRefresh = parseSession(
			{ ...session, refreshToken: 'refresh', refreshExpiresAt: 1_700_600_000 },
			{ pubkey: 'abc', workspaceId: 'org_1' },
			now
		);
		expect(withRefresh.refreshToken).toBe('refresh');
		expect(withRefresh.refreshExpiresAt).toBe(1_700_600_000);

		expect(() => parseSession(session, { pubkey: 'def', workspaceId: 'org_1' }, now)).toThrow(
			DataServiceError
		);
		expect(() => parseSession(session, { pubkey: 'abc', workspaceId: 'org_2' }, now)).toThrow(
			DataServiceError
		);
	});

	it('builds a challenge event without the setup code', () => {
		const template = buildAuthEventTemplate({
			baseUrl: 'https://service.example',
			challenge: {
				challengeId: 'ch_1',
				nonce: 'nonce',
				audience: 'https://service.example',
				expiresAt: 1_700_000_060,
				serviceId: 'svc_1',
				kind: DATA_SERVICE_AUTH_KIND
			},
			workspaceId: 'org_1',
			now
		});

		expect(template.kind).toBe(DATA_SERVICE_AUTH_KIND);
		expect(template.tags).toEqual(
			expect.arrayContaining([
				['u', 'https://service.example/v1/auth/verify'],
				['method', 'POST'],
				['challenge', 'nonce'],
				['audience', 'https://service.example'],
				['workspace', 'org_1']
			])
		);
		expect(JSON.stringify(template)).not.toContain('setup-code');
	});
});

describe('ingest and status responses', () => {
	it('parses accepted, duplicate and rejected ids', () => {
		const result = parseIngestResult({
			accepted: ['a'],
			duplicates: ['b'],
			rejected: [{ id: 'c', reason: 'unauthorized' }]
		});
		expect(result.accepted).toEqual(['a']);
		expect(result.duplicates).toEqual(['b']);
		expect(result.rejected[0].reason).toBe('unauthorized');
	});

	it('defaults unknown backup metadata instead of claiming recovery', () => {
		const status = parseStatus({ workspace: { id: 'org_1', name: 'Shop' } });
		expect(status.backup.state).toBe('unknown');
		expect(status.backup.lastBackupAt).toBeNull();
		expect(status.backup.lastVerifiedRestoreAt).toBeNull();
	});
});
