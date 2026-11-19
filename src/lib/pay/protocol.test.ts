import { describe, expect, it } from 'vitest';
import {
	BitosPayError,
	buildChallengeTemplate,
	normalizePayUrl,
	parsePayConnection,
	paySubject
} from './protocol';

describe('BitOS Pay URL validation', () => {
	it('accepts HTTPS and loopback HTTP', () => {
		expect(normalizePayUrl(' https://pay.example/ ')).toBe('https://pay.example');
		expect(normalizePayUrl('http://127.0.0.1:8788')).toBe('http://127.0.0.1:8788');
		expect(normalizePayUrl('http://localhost:8788/base/')).toBe('http://localhost:8788/base');
	});

	it('rejects credentials, queries and insecure remote origins', () => {
		for (const value of [
			'http://pay.example',
			'https://user:pass@pay.example',
			'https://pay.example/?token=1',
			'https://pay.example/#frag',
			'ftp://pay.example'
		]) {
			expect(() => normalizePayUrl(value)).toThrow(BitosPayError);
		}
	});
});

describe('workspace proof', () => {
	it('binds the workspace id and one-time challenge', () => {
		const template = buildChallengeTemplate({
			challenge: 'nch_1',
			origin: 'https://pay.example',
			workspaceId: 'org-123',
			now: 10
		});
		expect(template).toEqual({
			kind: 22242,
			created_at: 10,
			tags: [
				['relay', 'https://pay.example'],
				['challenge', 'nch_1'],
				['subject', 'bnos:org-123']
			],
			content: ''
		});
		expect(paySubject('org-123')).toBe('bnos:org-123');
	});
});

describe('connection storage shape', () => {
	it('round-trips a linked workspace', () => {
		const connection = {
			version: 1,
			baseUrl: 'https://pay.example',
			workspaceId: 'org-123',
			workspaceName: 'Shop',
			merchantId: 'mer_1',
			subjectRef: 'bnos:org-123',
			consoleUrl: 'https://pay.example/console/',
			apiKey: 'bp_test_abc',
			connectedAt: 1,
			syncedAt: 2
		};
		expect(parsePayConnection(connection)).toEqual(connection);
		expect(parsePayConnection({ ...connection, version: 2 })).toBeNull();
		expect(parsePayConnection({ ...connection, workspaceId: 1 })).toBeNull();
	});
});
