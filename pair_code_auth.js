/**
 * PAIR CODE AUTH — بدل QR code نستعملو pairing code (8 أرقام)
 * أسهل بكثير — ما خاصكش تسكان QR، غير تدخل الكود في WhatsApp
 */
// Fix SSL inspection issues on corporate networks
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
const path = require('path');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require('@whiskeysockets/baileys');
const pino = require('pino');

const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
// رقم الواتساب ديال البوت (الواسيط) — بدون + وبدون 00
const PHONE_NUMBER = '212699469649';

async function startPairAuth() {
  console.log('🔗 Starting Pairing Code Auth for', PHONE_NUMBER);
  
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  console.log('📦 Baileys version:', version.join('.'));

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'info' }),
    printQRInTerminal: false,
    browser: ['Windows', 'Chrome', '124.0.6367.82'],
    mobile: false,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
  });

  sock.ev.on('creds.update', saveCreds);

  if (!sock.authState.creds.registered) {
    // طلب pairing code
    await new Promise(r => setTimeout(r, 2000));
    const code = await sock.requestPairingCode(PHONE_NUMBER);
    console.log('\n');
    console.log('═══════════════════════════════════════');
    console.log('🔑 PAIRING CODE:', code);
    console.log('═══════════════════════════════════════');
    console.log('📱 Steps:');
    console.log('   1. Open WhatsApp on phone:', PHONE_NUMBER);
    console.log('   2. Go to: Settings → Linked Devices → Link a Device');
    console.log('   3. Tap "Link with phone number instead"');
    console.log('   4. Enter code:', code);
    console.log('═══════════════════════════════════════\n');
  }

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (connection === 'open') {
      console.log('\n✅ CONNECTED SUCCESSFULLY! Session saved.');
      console.log('🚀 Now run: node real_production_bot.js');
      setTimeout(() => process.exit(0), 2000);
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log(`Connection closed: ${code} - ${lastDisconnect?.error?.message || ''}`);
      if (code === DisconnectReason.loggedOut) {
        console.log('❌ Logged out. Clear auth_info_baileys and restart.');
        process.exit(1);
      }
      // 401 after pairing code = code not entered yet, retry
      // 403 = banned
      if (code === 403) {
        console.log('❌ Banned/Forbidden. This number cannot link more devices.');
        process.exit(1);
      }
      console.log('↩️  Retrying in 10s...');
      setTimeout(startPairAuth, 10000);
    }
  });
}

startPairAuth().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
