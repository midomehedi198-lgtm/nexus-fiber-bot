/**
 * QR Server v2 — HTTP server يعطي QR code كـ PNG ويحفظ الجلسة
 * افتح http://localhost:4000/qr في المتصفح باش تشوف QR
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
const path = require('path');
const http = require('http');
const fs = require('fs');
const QRCode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
const PORT = 4000;

let currentQR = null;
let status = 'starting';
let statusMsg = 'Connecting...';

// HTTP server لعرض QR
const server = http.createServer(async (req, res) => {
  if (req.url === '/qr' || req.url === '/') {
    if (status === 'connected') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1 style="color:green;font-family:sans-serif;text-align:center;margin-top:40px">✅ WhatsApp Connected!<br>Bot is ready.</h1>');
      return;
    }
    if (!currentQR) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="font-family:sans-serif;text-align:center;background:#111;color:#fff">
        <h2>⏳ ${statusMsg}</h2>
        <p>Refresh this page every 3 seconds until QR appears.</p>
        <meta http-equiv="refresh" content="3">
      </body></html>`);
      return;
    }
    // Generate QR image inline
    const qrDataUrl = await QRCode.toDataURL(currentQR, { width: 500, margin: 2 });
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<html><body style="font-family:sans-serif;text-align:center;background:#111;color:#fff;padding:20px">
      <h2>📱 Scan this QR with WhatsApp</h2>
      <p>Open WhatsApp → Linked Devices → Link a Device → Scan QR</p>
      <img src="${qrDataUrl}" style="border:8px solid white;border-radius:12px;max-width:400px"/>
      <p style="color:#aaa;font-size:12px">QR expires in ~20 seconds. <a href="/qr" style="color:#4af">Refresh</a> for new one.</p>
      <meta http-equiv="refresh" content="20">
    </body></html>`);
  } else if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status, msg: statusMsg }));
  } else {
    res.writeHead(302, { Location: '/qr' });
    res.end();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌐 QR Server started!`);
  console.log(`📱 Open in browser: http://localhost:${PORT}/qr`);
  console.log(`   Then scan the QR with WhatsApp on the bot phone.\n`);
});

async function startAuth() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  console.log(`📦 WA version: ${version.join('.')}`);

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['Windows', 'Chrome', '124.0.6367.82'],
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      currentQR = qr;
      statusMsg = 'QR Ready — Scan it!';
      console.log('📸 New QR generated — open http://localhost:' + PORT + '/qr');
      
      // Also save to desktop
      try {
        await QRCode.toFile('C:\\Users\\Dell\\Desktop\\SCAN_ME.png', qr, { width: 500, margin: 2 });
        console.log('💾 QR also saved to Desktop as SCAN_ME.png');
      } catch (_) {}
    }

    if (connection === 'open') {
      currentQR = null;
      status = 'connected';
      statusMsg = 'Connected! ✅';
      console.log('\n✅ WhatsApp CONNECTED! Session saved.');
      console.log('🚀 Now run: node real_production_bot.js\n');
      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 5000);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log(`⚠️ Disconnected [${code}]`);
      currentQR = null;

      if (code === DisconnectReason.loggedOut || code === 403) {
        statusMsg = '❌ Logged out! Restart.';
        process.exit(1);
      }

      const delay = code === 500 ? 15000 : 5000;
      statusMsg = `Reconnecting in ${delay/1000}s...`;
      console.log(`↩️  Retrying in ${delay/1000}s...`);
      setTimeout(startAuth, delay);
    }
  });
}

startAuth().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
