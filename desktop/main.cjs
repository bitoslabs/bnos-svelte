const { app, BrowserWindow, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');

protocol.registerSchemesAsPrivileged([
	{ scheme: 'bnos', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

const origin = 'bnos://app';
const root = path.join(__dirname, '..', 'desktop-build');

async function createWindow() {
	const window = new BrowserWindow({
		width: 1280,
		height: 800,
		minWidth: 800,
		minHeight: 600,
		webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
	});

	window.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
		return { action: 'deny' };
	});
	window.webContents.on('will-navigate', (event, url) => {
		const destination = new URL(url);
		if (destination.protocol !== 'bnos:' || destination.host !== 'app') {
			event.preventDefault();
			if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
		}
	});
	await window.loadURL(origin + '/');
}

app.whenReady().then(() => {
	protocol.handle('bnos', async (request) => {
		const url = new URL(request.url);
		if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
		let pathname;
		try {
			pathname = decodeURIComponent(url.pathname);
		} catch {
			return new Response('Bad request', { status: 400 });
		}
		const file = path.resolve(root, '.' + pathname);
		if (file !== root && !file.startsWith(root + path.sep)) {
			return new Response('Forbidden', { status: 403 });
		}
		try {
			if ((await fs.stat(file)).isFile()) return net.fetch(pathToFileURL(file).toString());
		} catch {
			// Client routes are served by the SPA fallback; missing assets remain 404s.
		}
		if (path.extname(pathname)) return new Response('Not found', { status: 404 });
		return net.fetch(pathToFileURL(path.join(root, 'index.html')).toString());
	});
	void createWindow();
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) void createWindow();
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
