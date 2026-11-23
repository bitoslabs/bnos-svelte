#!/usr/bin/env node
/**
 * Local ESC/POS print bridge for BNOS POS.
 *
 * Allows https://app.bnos.space (configured with a "Webhook" printer pointing
 * to http://127.0.0.1:3100/print) to print to a local LAN/WiFi thermal printer
 * over raw TCP port 9100 without HTTP headers.
 *
 * Usage:
 *   node scripts/print-bridge.mjs
 *   PRINTER_IP=192.168.2.100 PRINTER_PORT=9100 LISTEN_PORT=3100 node scripts/print-bridge.mjs
 */
import http from 'node:http';
import net from 'node:net';

const PRINTER_IP = process.env.PRINTER_IP || '192.168.2.100';
const PRINTER_PORT = Number(process.env.PRINTER_PORT || 9100);
const LISTEN_PORT = Number(process.env.LISTEN_PORT || 3100);

function sendToPrinter(host, port, buf) {
	return new Promise((resolve, reject) => {
		let settled = false;
		const socket = net.createConnection({ host, port });
		socket.setNoDelay(true);
		socket.setTimeout(12000);

		const done = (err) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			if (err) reject(err);
			else resolve();
		};

		socket.on('connect', () => {
			socket.write(buf, (err) => {
				if (err) return done(err);
				socket.end(() => done());
			});
		});
		socket.on('timeout', () => done(new Error(`Timed out connecting to ${host}:${port}`)));
		socket.on('error', done);
	});
}

const server = http.createServer((req, res) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
	res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
	if (req.method === 'OPTIONS') return res.writeHead(204).end();
	if (req.method !== 'POST') return res.writeHead(405).end();

	const chunks = [];
	req.on('data', (c) => chunks.push(c));
	req.on('end', async () => {
		try {
			const raw = Buffer.concat(chunks);
			const isJson = (req.headers['content-type'] || '').includes('application/json');
			let payload = raw;
			let targetIp = PRINTER_IP;
			let targetPort = PRINTER_PORT;

			if (isJson) {
				const body = JSON.parse(raw.toString('utf8'));
				if (typeof body.ip === 'string' && body.ip.trim()) targetIp = body.ip.trim();
				if (body.port) targetPort = Number(body.port) || PRINTER_PORT;

				if (body.type === 'test') {
					payload = Buffer.from('\x1b@\x1c.\x1bt\x00BNOS Print Bridge Test OK\n\n\n\n\x1dV\x00');
				} else if (body.dataBase64) {
					payload = Buffer.from(body.dataBase64, 'base64');
				}
			}

			if (!payload.length) {
				res.writeHead(400, { 'Content-Type': 'application/json' });
				return res.end(JSON.stringify({ ok: false, error: 'Empty print payload' }));
			}

			await sendToPrinter(targetIp, targetPort, payload);
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ ok: true, bytes: payload.length }));
		} catch (err) {
			res.writeHead(502, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })
			);
		}
	});
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
	console.log(
		`BNOS print bridge listening on http://127.0.0.1:${LISTEN_PORT}/print -> ${PRINTER_IP}:${PRINTER_PORT}`
	);
});
