# Thermal Receipt Printing (ESC/POS)

BNOS POS supports thermal receipt printing (Xprinter, Epson, Star, and compatible ESC/POS printers) from **POS** (`printPosReceipt`) and **Orders** (`printReceiptForOrder`).

## Architecture

- [`src/lib/pos/escpos.ts`](../src/lib/pos/escpos.ts) — Builds raw ESC/POS byte payloads (`buildEscPosReceipt`, `buildTestReceiptBytes`), normalizes Unicode spaces/symbols, and sends `ESC @`, `FS .` (exit 2-byte Chinese/Kanji mode), `ESC t 0` (PC437), `autoCut`, and `cashDrawerEnabled` kick commands.
- [`src/lib/settings/printers.ts`](../src/lib/settings/printers.ts) — Stores printer profiles in `localStorage` (`bnos-os:printers`) and dispatches ESC/POS jobs via `sendEscPosToPrinter()`.
- [`src/lib/print/sdk.ts`](../src/lib/print/sdk.ts) — Vendored BNOS Print Service web SDK (desktop HTTP client + `bnos-print://` deeplink builder). Mirrors [`@bnos/print-sdk`](https://github.com/bitoslabs/bitos-print-service/tree/main/packages/web-sdk).
- [`src/lib/print/native.ts`](../src/lib/print/native.ts) — Integration layer: health probe, native job dispatch, setup deeplink, and callback result parsing.
- [`src/routes/api/print/+server.ts`](../src/routes/api/print/+server.ts) — Optional SvelteKit `POST /api/print` endpoint that forwards `{ ip, port, dataBase64 }` over raw TCP (`node:net`).
- [`scripts/print-bridge.mjs`](../scripts/print-bridge.mjs) — Standalone local Node.js HTTP-to-TCP bridge for hosted deployments (such as `https://app.bnos.space`).

The native service itself lives in a separate repository:
**[github.com/bitoslabs/bitos-print-service](https://github.com/bitoslabs/bitos-print-service)**.

---

## Setup Options

### 1. BNOS Print Service — desktop daemon & mobile app (Recommended)

The native print service replaces `print-bridge.mjs` and adds Bluetooth/USB support on mobile.

- **Desktop (macOS / Windows / Linux)**: runs a local daemon on `http://127.0.0.1:3100` with the same `/print` contract as the legacy bridge (plus `/health`, `/printers`, and WebSocket).
- **iOS / Android**: the companion **BNOS Print** app receives `bnos-print://` deeplinks from the browser and prints over LAN TCP, Bluetooth, or USB OTG.

**In BNOS:**

1. Open **Settings → Printers**. The **BNOS Print Service** card shows whether the desktop daemon is reachable and offers **Set up on this device** (`bnos-print://setup`) plus a GitHub link.
2. **Add printer**, set **Connection** to **BNOS Print Service**, choose a transport
   (`LAN TCP`, `Bluetooth LE`, `Bluetooth SPP`, or `USB`), then enter the IP/port or MAC address.
3. Set it as **Default** and click **Test**. The test is routed through the daemon (desktop) or the print app (mobile).

**POS behaviour:** `printPosReceipt()` routes ESC/POS jobs to the native service automatically. On mobile the browser cannot open raw TCP sockets, so the job is handed off with a `bnos-print://print?...` deeplink and returns to the current page with `?ok=1&jobId=…` or `?ok=0&error=…`; the app surfaces that result as a toast. Desktop sends the bytes straight to `http://127.0.0.1:3100/print`.

Mobile browsers cannot reach LAN IPs such as `192.168.x.x:9100` directly, so on mobile **Network / IP** and **Bluetooth** profiles are transparently upgraded to the native deeplink path when they are printed.

### 2. Hosted App (`https://app.bnos.space`) + WiFi/LAN Printer (legacy bridge)

A cloud-hosted server cannot reach private LAN IPs like `192.168.2.100`, and web browsers cannot open raw TCP sockets without adding HTTP headers. Use the local print bridge on a computer connected to the same WiFi/LAN as your printer:

1. Start the bridge on your POS computer:

   ```bash
   node scripts/print-bridge.mjs
   ```

   Optional environment variables (defaults shown):

   ```bash
   PRINTER_IP=192.168.2.100 PRINTER_PORT=9100 LISTEN_PORT=3100 node scripts/print-bridge.mjs
   ```

2. In **Settings → Printers**, add/edit a printer:
   - **Connection:** `Webhook`
   - **URL:** `http://127.0.0.1:3100/print`
   - **Payload format:** `Raw ESC/POS` (or `JSON Object`)
   - Enable the printer, set it as **Default**, and click **Test**.

> If Chrome prompts to allow local network access for `https://app.bnos.space`, click **Allow**.

### 3. Self-Hosted / Local Dev Server on the Same WiFi

When the SvelteKit Node server runs on the same LAN as the printer (e.g. `pnpm dev` or a local Node deployment):

1. In **Settings → Printers**, add/edit a printer:
   - **Connection:** `Network / IP`
   - **IP address:** `192.168.2.100` (your printer's LAN IP)
   - **Port:** `9100`
   - **Send via server (`/api/print`):** **ON**
2. Set as **Default** and click **Test**.

You can also test `/api/print` directly with `curl`:

```bash
curl -X POST http://localhost:5173/api/print \
  -H "Content-Type: application/json" \
  -d '{"ip":"192.168.2.100","port":9100,"dataBase64":"G0BCTk9TIFRlc3QgT0sKCgoKHVYA"}'
```

### 4. Browser System Print Dialog (OS Driver)

Install the printer driver in your OS (macOS / Windows / Linux) pointing to `192.168.2.100:9100` (HP Jetdirect / Raw TCP), and set the printer connection in **Settings → Printers** to **Browser**. Printing opens `window.print()`.

---

## Troubleshooting

- **Receipt prints `POST / HTTP/1.1`, `Host:`, `User-Agent:` at the top:**
  You are sending directly from browser `fetch()` to `http://<ip>:9100` (`Send via server (/api/print)` is OFF). Browsers always prepend HTTP headers to `fetch()` requests, and raw port `9100` prints every byte it receives. Switch to **Webhook** + `scripts/print-bridge.mjs` (or turn **Send via server (`/api/print`)** ON when running on the same LAN).
- **`504 Gateway Timeout` from `/api/print`:**
  - Verify the printer IP (e.g. `192.168.2.100`, not a typo) and port `9100`.
  - Ensure the server running `/api/print` is on the same WiFi/LAN as the printer (not a cloud server).
  - Check that no other device is holding an open TCP connection to port `9100` (many WiFi thermal printers accept only one TCP client at a time).
- **BNOS Print Service card says “Not running”:**
  - Start **BNOSPrint** (macOS) or `print-daemon`/`BNOSPrintTray` (Windows/Linux). The daemon listens on `http://127.0.0.1:3100`.
  - Verify with `curl http://127.0.0.1:3100/health`.
  - If the printer is on another machine, enable LAN access in the daemon and use the legacy Webhook path instead (HTTPS pages cannot call `http://192.168.x.x`).
- **Mobile deeplink does nothing:**
  - Install the **BNOS Print** app, then use **Set up on this device** in Settings → Printers to open `bnos-print://setup`.
  - Custom schemes only open from a user gesture; the Print button in POS provides one. A missing callback usually means the app was force-closed before printing finished.
