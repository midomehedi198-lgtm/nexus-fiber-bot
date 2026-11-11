const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
const DESKTOP_QR = 'C:\\Users\\Dell\\Desktop\\SCAN_ME.png';
const HTML_VIEW = path.join(__dirname, 'whatsapp_qr_view.html');

async function runQrService() {
  console.log('⚡ Initializing WhatsApp QR Service...');
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['Chrome (Linux)', '', '']
  });

  sock.ev.on('creds.update', saveCreds);

  let opened = false;
  sock.ev.on('connection.update', async (update) => {
    const { qr, connection, lastDisconnect } = update;

    if (qr) {
      console.log('📸 Generating high-res QR code image...');
      // 1. Sauvegarder sur le Bureau de l'utilisateur
      await QRCode.toFile(DESKTOP_QR, qr, {
        width: 550,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      });
      console.log('✅ QR Image saved to: ' + DESKTOP_QR);

      // 2. Ouvrir immédiatement sur l'écran dans Paint ou visionneuse d'images
      if (!opened) {
        opened = true;
        console.log('🚀 Opening QR code on your screen now...');
        exec(`mspaint.exe "${DESKTOP_QR}"`);
      }
    }

    if (connection === 'open') {
      console.log('🎉 WHATSAPP_CONNECTED_SUCCESSFULLY!');
      fs.writeFileSync('C:\\Users\\Dell\\Desktop\\WHATSAPP_CONNECTED.txt', 'SUCCESS');
      console.log('Session saved. Ready to launch production bot!');
      setTimeout(() => {
        process.exit(0);
      }, 3000);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log(`Connection closed with code: ${code}`);
      if (code === DisconnectReason.loggedOut) {
        console.log('Logged out. Please restart.');
        process.exit(1);
      } else {
        console.log('Reconnecting QR service...');
        runQrService();
      }
    }
  });
}

runQrService();
