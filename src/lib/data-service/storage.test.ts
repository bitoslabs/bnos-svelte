import { describe, expect, it } from 'vitest';
import { emptyQueue, enqueueEvent } from './queue';
import {
	clearAllSessions,
	clearConnection,
	clearQueue,
	clearSession,
	readConnection,
	readQueue,
	readSession,
	queueKey,
	writeConnection,
	writeQueue,
	writeSession,
	type ConnectionMetadata
} from './storage';

class MemoryStorage implements Storage {
	private values = new Map<string, string>();

	get length() {
		return this.values.size;
	}

	clear() {
		this.values.clear();
	}

	getItem(key: string) {
		return this.values.get(key) ?? null;
	}

	key(index: number) {
		return [...this.values.keys()][index] ?? null;
	}

	removeItem(key: string) {
		this.values.delete(key);
	}

	setItem(key: string, value: string) {
		this.values.set(key, value);
	}
}

const metadata: ConnectionMetadata = {
	version: 1,
	mode: 'selfHosted',
	baseUrl: 'https://service.example',
	serviceId: 'svc_1',
	serviceName: 'Service',
	workspaceId: 'org_1',
	workspaceName: 'Shop',
	audience: 'https://service.example',
	connectedAt: 1,
	lastSyncAt: null,
	capabilities: { backup: true, status: true, reporting: false, restoreStatus: true }
};

describe('data service storage isolation', () => {
	it('never returns another workspace connection', () => {
		const storage = new MemoryStorage();
		writeConnection(metadata, storage);
		expect(readConnection('org_1', storage)?.workspaceId).toBe('org_1');
		expect(readConnection('org_2', storage)).toBeNull();
	});

	it('drops connection and session but keeps the unsent queue', () => {
		const localStorage = new MemoryStorage();
		const sessionStorage = new MemoryStorage();
		writeConnection(metadata, localStorage);
		writeSession(
			{
				token: 'secret',
				expiresAt: 2,
				pubkey: 'abc',
				workspaceId: 'org_1',
				refreshToken: 'refresh',
				refreshExpiresAt: 3
			},
			sessionStorage
		);
		expect(readSession('org_1', sessionStorage)?.refreshToken).toBe('refresh');
		writeQueue('org_1', enqueueEvent(emptyQueue(), { id: 'e1' }).queue, localStorage);

		clearConnection('org_1', localStorage);
		clearSession('org_1', sessionStorage);

		expect(readConnection('org_1', localStorage)).toBeNull();
		expect(readSession('org_1', sessionStorage)).toBeNull();
		expect(readQueue('org_1', localStorage).items).toHaveLength(1);

		clearQueue('org_1', localStorage);
		expect(readQueue('org_1', localStorage).items).toHaveLength(0);
	});

	it('preserves unreadable queues instead of treating them as empty', () => {
		const storage = new MemoryStorage();
		for (const raw of [
			'broken',
			JSON.stringify({ version: 2, items: [] }),
			JSON.stringify({ version: 1, items: [{ id: 'bad', event: {} }] })
		]) {
			storage.setItem(queueKey('org_1'), raw);
			expect(() => readQueue('org_1', storage)).toThrow();
			expect(() =>
				writeQueue('org_1', enqueueEvent(emptyQueue(), { id: 'new' }).queue, storage)
			).toThrow();
			expect(storage.getItem(queueKey('org_1'))).toBe(raw);
		}
	});

	it('clears every service session on logout or identity switch', () => {
		const storage = new MemoryStorage();
		writeSession({ token: 'a', expiresAt: 2, pubkey: 'abc', workspaceId: 'org_1' }, storage);
		writeSession({ token: 'b', expiresAt: 2, pubkey: 'abc', workspaceId: 'org_2' }, storage);
		storage.setItem('unrelated', 'keep');

		clearAllSessions(storage);

		expect(readSession('org_1', storage)).toBeNull();
		expect(readSession('org_2', storage)).toBeNull();
		expect(storage.getItem('unrelated')).toBe('keep');
	});
});
