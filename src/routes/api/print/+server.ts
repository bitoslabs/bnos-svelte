import net from 'node:net';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const MAX_PRINT_BYTES = 512 * 1024;
const SOCKET_TIMEOUT_MS = 12000;

function isValidIpv4(ip: string): boolean {
	if (!IPV4_RE.test(ip)) return false;
	return ip.split('.').every((octet) => Number(octet) <= 255);
}

function sendTcp(host: string, port: number, payload: Buffer): Promise<void> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const socket = net.createConnection({ host, port });
		socket.setNoDelay(true);
		socket.setTimeout(SOCKET_TIMEOUT_MS);

		const finish = (err?: Error) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			if (err) reject(err);
			else resolve();
		};

		socket.on('connect', () => {
			socket.write(payload, (writeErr) => {
				if (writeErr) return finish(writeErr);
				socket.end(() => finish());
			});
		});

		socket.on('timeout', () => {
			finish(new Error(`Timed out connecting to ${host}:${port}`));
		});

		socket.on('error', (err) => {
			finish(err);
		});
	});
}

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
	}

	if (!body || typeof body !== 'object') {
		return json({ ok: false, error: 'Invalid request body' }, { status: 400 });
	}

	const {
		ip,
		port: rawPort,
		dataBase64
	} = body as {
		ip?: unknown;
		port?: unknown;
		dataBase64?: unknown;
	};

	const host = typeof ip === 'string' ? ip.trim() : '';
	if (!isValidIpv4(host)) {
		return json({ ok: false, error: 'Valid IPv4 address is required' }, { status: 400 });
	}

	const port = rawPort === undefined || rawPort === '' ? 9100 : Number(rawPort);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		return json({ ok: false, error: 'Port must be 1–65535' }, { status: 400 });
	}

	if (typeof dataBase64 !== 'string' || !dataBase64) {
		return json({ ok: false, error: 'dataBase64 is required' }, { status: 400 });
	}

	const payload = Buffer.from(dataBase64, 'base64');
	if (payload.length === 0 || payload.length > MAX_PRINT_BYTES) {
		return json({ ok: false, error: 'Invalid print payload size' }, { status: 400 });
	}

	try {
		await sendTcp(host, port, payload);
		return json({ ok: true, bytes: payload.length });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to send print data';
		const isTimeout = message.toLowerCase().includes('timed out');
		return json({ ok: false, error: message }, { status: isTimeout ? 504 : 502 });
	}
};
