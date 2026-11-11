/**
 * PAIR CODE AUTH — بدل QR code نستعملو pairing code (8 أرقام)
 * أسهل بكثير — ما خاصكش تسكان QR، غير تدخل الكود في WhatsApp
 */
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
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['Chrome (Linux)', 'Chrome', '120.0.0'],
    mobile: false,
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
      console.log('Connection closed:', code);
      if (code === DisconnectReason.loggedOut) {
        console.log('❌ Logged out. Clear auth_info_baileys and retry.');
        process.exit(1);
      }
      if (code !== 403) {
        console.log('Retrying...');
        setTimeout(startPairAuth, 5000);
      }
    }
  });
}

startPairAuth().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
