/**
 * ============================================================================
 * NEXUS-TELECOM: AUTOMATED MOROCCAN FIBER OPTIC BOT
 * Stack: Node.js + Express + @whiskeysockets/baileys + @turf/turf + MongoDB
 * ============================================================================
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const pino = require('pino');
const { MongoClient } = require('mongodb');
const turf = require('@turf/turf');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const { askMultiTierLLM } = require('./multi_llm_engine');

// 1. CONFIGURATION & ENVIRONMENT VARIABLES
const PORT = process.env.PORT || 3000;
const AUTH_DIR = process.env.AUTH_DIR || path.join(__dirname, 'auth_info_baileys');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'telecom_leads_db';
const ADMIN_PHONE = (process.env.ADMIN_PHONE || '212625489153').replace(/\D/g, '');
const WASIT_PHONE = (process.env.WASIT_PHONE || ADMIN_PHONE).replace(/\D/g, '');
const BOT_PHONE = (process.env.BOT_PHONE || '212699469649').replace(/\D/g, '');

let pairingCodeRequested = false;

const logger = pino({ level: 'info' });

// Assurer l'existence du dossier de session Baileys
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

// 2. MONGODB CLIENT & REPOSITORY
let db = null;
let leadsCollection = null;
let conversationsCollection = null;

async function connectMongoDB() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DB_NAME);
    leadsCollection = db.collection('leads');
    conversationsCollection = db.collection('conversations');
    logger.info(` Connected to MongoDB Atlas (${DB_NAME})`);
  } catch (err) {
    logger.error({ err }, ' MongoDB connection failed - running in fallback mode');
  }
}

// 3. CHARGEMENT DU MOTEUR SPATIAL (TURF.JS & GEOJSON)
let zonesData = { type: 'FeatureCollection', features: [] };
const zonesPath = path.join(__dirname, 'zones.geojson');

function loadZones() {
  try {
    if (fs.existsSync(zonesPath)) {
      const raw = fs.readFileSync(zonesPath, 'utf8');
      zonesData = JSON.parse(raw);
      logger.info(` Loaded ${zonesData.features.length} fiber coverage zones from zones.geojson`);
    } else {
      logger.warn(' zones.geojson not found! Coverage checks will return fallback.');
    }
  } catch (err) {
    logger.error({ err }, ' Error loading zones.geojson');
  }
}
loadZones();

/**
 * MOTEUR SIG & BUFFER INTELLIGENT
 * - Test direct dans le polygone
 * - Test Buffer standard 15m (تجرار لموبل قريب)
 * - Smart Proximity Fallback (50m - 100m) بنسبة 90%
 */
function evaluateLocationCoverage(latitude, longitude) {
  if (!zonesData || !zonesData.features || zonesData.features.length === 0) {
    return {
      status: 'NO_DATA',
      operators: [],
      notes: 'قاعدة بيانات التغطية غير محملة'
    };
  }

  const customerPoint = turf.point([longitude, latitude]);

  // Phase A: Intersection directe (داخل البوليغون بالضبط)
  for (const zone of zonesData.features) {
    try {
      if (turf.booleanPointInPolygon(customerPoint, zone)) {
        return {
          status: 'DIRECT_COVERAGE',
          operator: zone.properties.isp || 'IAM / Inwi',
          city: zone.properties.city || 'المدينة',
          neighborhood: zone.properties.name || 'الحي',
          notes: 'تغطية فايبر مباشرة ومضمونة'
        };
      }
    } catch (e) {
      // Ignorer les géométries corrompues
    }
  }

  // Phase B: Buffer standard de 15 mètres (تجرار لعمارة ملاصقة أو زنقة متقابلة)
  for (const zone of zonesData.features) {
    try {
      const buffered15m = turf.buffer(zone, 0.015, { units: 'kilometers' });
      if (turf.booleanPointInPolygon(customerPoint, buffered15m)) {
        return {
          status: 'BUFFER_15M',
          operator: zone.properties.isp || 'IAM / Inwi',
          city: zone.properties.city || 'المدينة',
          neighborhood: zone.properties.name || 'الحي',
          notes: 'ممكن التركيب عبر تمديد خفيف (تجرار لموبل قريب)'
        };
      }
    } catch (e) {}
  }

  // Phase C: Smart Proximity Fallback (50m - 100m) بنسبة 90%
  for (const zone of zonesData.features) {
    try {
      const buffered100m = turf.buffer(zone, 0.1, { units: 'kilometers' });
      if (turf.booleanPointInPolygon(customerPoint, buffered100m)) {
        return {
          status: 'PROXIMITY_90_PERCENT',
          operator: zone.properties.isp || 'IAM / Inwi',
          city: zone.properties.city || 'المدينة',
          neighborhood: zone.properties.name || 'الحي',
          notes: 'شبكة قريبة جداً في نفس الحي (احتمال نجاح التمديد مرتفع بنسبة 90%)'
        };
      }
    } catch (e) {}
  }

  return {
    status: 'NO_COVERAGE',
    operators: [],
    city: 'غير محدد',
    notes: 'خارج نطاق التغطية الحالية'
  };
}

// 4. BAILEYS CLIENT (WHATSAPP WEBSOCKET SANS CHROME)
let sock = null;

async function startWhatsAppBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info(` Starting Baileys WA Socket (v${version.join('.')}, isLatest: ${isLatest})`);

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: ['Chrome (Linux)', '', '']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Si déjà enregistré, ne pas demander de code
    if (!state.creds.me && !pairingCodeRequested) {
      pairingCodeRequested = true;
    }

    if (qr) {
      console.log('\n======================================================');
      console.log('📲 SCAN THIS QR CODE WITH YOUR WHATSAPP BUSINESS PHONE:');
      console.log('======================================================\n');
      qrcodeTerminal.generate(qr, { small: true });

      // Enregistrer également l'image QR sur le Bureau pour scan facile
      const desktopQrPath = 'C:\\Users\\Dell\\Desktop\\WHATSAPP_QR.png';
      QRCode.toFile(desktopQrPath, qr, { width: 400 }, function (err) {
        if (!err) {
          logger.info(`📸 QR Code image saved to Desktop: ${desktopQrPath}`);
        }
      });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      logger.warn(` WhatsApp connection closed (code: ${statusCode}). Reconnecting: ${shouldReconnect}`);
      if (shouldReconnect) {
        pairingCodeRequested = false;
        setTimeout(startWhatsAppBot, 3000);
      }
    } else if (connection === 'open') {
      logger.info(' WhatsApp Bot is ONLINE and connected successfully! 🚀');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid.endsWith('@s.whatsapp.net')) continue; // ignorer les groupes

      const customerPhone = remoteJid.replace('@s.whatsapp.net', '');
      await handleIncomingMessage(remoteJid, customerPhone, msg);
    }
  });
}

/**
 * 5. GESTION DE LA CONVERSATION EN DARIJA MAROCAINE
 */
async function handleIncomingMessage(jid, phone, msg) {
  try {
    let session = { step: 'WAITING_LOCATION' };

    if (conversationsCollection) {
      const found = await conversationsCollection.findOne({ phone });
      if (found) session = found;
    }

    const messageContent = msg.message;

    // Détection d'un PIN de localisation WhatsApp (Location Pin)
    const locationMessage =
      messageContent.locationMessage ||
      messageContent.liveLocationMessage;

    if (locationMessage) {
      const lat = locationMessage.degreesLatitude;
      const lng = locationMessage.degreesLongitude;

      logger.info(`📍 Received Location Pin from ${phone}: Lat ${lat}, Lng ${lng}`);

      const result = evaluateLocationCoverage(lat, lng);

      if (result.status === 'DIRECT_COVERAGE' || result.status === 'BUFFER_15M') {
        session.step = 'WAITING_NAME';
        session.lat = lat;
        session.lng = lng;
        session.status = result.status;
        session.operator = result.operator;
        session.city = result.city;
        session.neighborhood = result.neighborhood;

        if (conversationsCollection) {
          await conversationsCollection.updateOne(
            { phone },
            { $set: session },
            { upsert: true }
          );
        }

        const reply =
          `✅ *أهلاً بك أخي الكريم! خبار زوين بزاف* 🎉\n\n` +
          `التغطية ديال الفايبر أوبتيك (*${result.operator}*) متوفرة في موقعك بـ *${result.city}* (${result.neighborhood}).\n` +
          `${result.status === 'BUFFER_15M' ? '⚡ (إمكانية التمديد والتجرار مباشرة للبناية ديالك متاحة ومضمونة)\n' : ''}\n` +
          `عفاك صيفط ليا *الاسم الكامل* ديالك باش ندوزو الدوسي للتقني ويتاصل بك اليوم لتحديد موعد التركيب 🚀.`;

        await sock.sendMessage(jid, { text: reply });
        return;
      } else if (result.status === 'PROXIMITY_90_PERCENT') {
        session.step = 'WAITING_NAME';
        session.lat = lat;
        session.lng = lng;
        session.status = result.status;
        session.operator = result.operator;
        session.city = result.city;
        session.neighborhood = result.neighborhood;

        if (conversationsCollection) {
          await conversationsCollection.updateOne(
            { phone },
            { $set: session },
            { upsert: true }
          );
        }

        const reply =
          `👋 *مرحباً بك خويا العزيز!*\n\n` +
          `البلاصة ديالك قريبة بزاف لشبكة الفايبر أوبتيك ديال (*${result.operator}*) على بعد أمتار قليلة (نسبة نجاح التجرار تفوق 90% 📶).\n\n` +
          `باش نأكدوا مع التقني الميداني إمكانية التوصيل للبناية ديالك، عفاك صيفط لينا *الاسم الكامل* ديالك دابا.`;

        await sock.sendMessage(jid, { text: reply });
        return;
      } else {
        // Hors couverture
        session.step = 'OUT_OF_COVERAGE';
        session.lat = lat;
        session.lng = lng;

        if (conversationsCollection) {
          await conversationsCollection.updateOne(
            { phone },
            { $set: session },
            { upsert: true }
          );
        }

        if (leadsCollection) {
          await leadsCollection.insertOne({
            phone,
            lat,
            lng,
            status: 'OUT_OF_COVERAGE',
            createdAt: new Date()
          });
        }

        const reply =
          `للأسف أخاي العزيز، المنطقة ديالك مزال ما وصلهاش الفايبر فهاد اللحظة ⏳.\n\n` +
          `راني قيدت الرقم ديالك عندي، وغير تكون كابلاج جديد أو توسيع للشبكة في حيكم غادي نتاصلو بك أول واحد إن شاء الله! شكراً ليك 🙏`;

        await sock.sendMessage(jid, { text: reply });
        return;
      }
    }

    // Réception de texte
    const text = (
      messageContent.conversation ||
      messageContent.extendedTextMessage?.text ||
      ''
    ).trim();

    if (!text) return;

    if (session.step === 'WAITING_NAME') {
      const customerName = text;

      // Sauvegarde du Lead final qualifié
      const leadDocument = {
        name: customerName,
        phone,
        lat: session.lat,
        lng: session.lng,
        city: session.city,
        neighborhood: session.neighborhood,
        operator: session.operator,
        status: session.status,
        createdAt: new Date()
      };

      if (leadsCollection) {
        await leadsCollection.insertOne(leadDocument);
      }

      // Confirmation au client
      const confirmationMsg =
        `تم تسجيل طلبك بنجاح سي *${customerName}*! ✅\n\n` +
        `غادي يتاصل بك التقني ديال الفايبر (*${session.operator}*) في أقرب وقت لتأكيد موعد التركيب المجاني مع الروتور.\n` +
        `شكراً على ثقتك بنا 🤝!`;

      await sock.sendMessage(jid, { text: confirmationMsg });

      // NOTIFICATION DOUBLE INSTANTANÉE (ADMIN + TECHNICIEN / WASIT)
      await sendDualNotification(leadDocument);

      session.step = 'COMPLETED';
      if (conversationsCollection) {
        await conversationsCollection.updateOne(
          { phone },
          { $set: session }
        );
      }
      return;
    }

    // Multi-tier LLM response for inquiries & conversations
    const llmReply = await askMultiTierLLM(text);
    logger.info(`🤖 Multi-LLM [Tier ${llmReply.tier} - ${llmReply.provider}] -> ${phone}`);
    await sock.sendMessage(jid, { text: llmReply.text });
  } catch (err) {
    logger.error({ err }, ' Error handling message');
  }
}

/**
 * 6. DUAL WHATSAPP NOTIFICATION (ADMIN + WASIT)
 */
async function sendDualNotification(lead) {
  const gmapsLink = `https://maps.google.com/?q=${lead.lat},${lead.lng}`;

  const alertText =
    `🚨 *طلب اشتراك فايبر جديد وارد للتو! (NEXUS LEAD)* 🚨\n\n` +
    `👤 *الزبون:* ${lead.name}\n` +
    `📞 *الهاتف:* +${lead.phone}\n` +
    `📍 *المدينة / الحي:* ${lead.city} - ${lead.neighborhood}\n` +
    `📡 *المشغل المتوفر:* ${lead.operator}\n` +
    `📊 *حالة التغطية:* ${lead.status}\n` +
    `🗺️ *موقع الزبون على الخريطة:* ${gmapsLink}\n\n` +
    `⚡ المرجو من الفني / الوسيط الاتصال به فوراً لإغلاق الصفقة!`;

  const recipients = [ADMIN_PHONE];
  if (WASIT_PHONE && WASIT_PHONE !== ADMIN_PHONE) {
    recipients.push(WASIT_PHONE);
  }

  for (const recipient of recipients) {
    try {
      const recipientJid = `${recipient}@s.whatsapp.net`;
      await sock.sendMessage(recipientJid, { text: alertText });
      logger.info(` Alert sent successfully to WhatsApp destination: ${recipient}`);
    } catch (err) {
      logger.error({ err, recipient }, ' Failed to send WhatsApp notification');
    }
  }
}

// 7. EXPRESS SERVER & HEALTH CHECK ENDPOINTS
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Nexus-Telecom WhatsApp Lead Bot is RUNNING.');
});

app.get('/health/ready', (req, res) => {
  const isWaConnected = sock && sock.user;
  const isDbConnected = db !== null;
  const zonesLoaded = zonesData.features.length > 0;

  if (isWaConnected && isDbConnected && zonesLoaded) {
    return res.status(200).json({
      status: 'READY',
      whatsapp: 'CONNECTED',
      database: 'CONNECTED',
      zonesCount: zonesData.features.length
    });
  }

  return res.status(503).json({
    status: 'DEGRADED',
    whatsapp: isWaConnected ? 'CONNECTED' : 'DISCONNECTED',
    database: isDbConnected ? 'CONNECTED' : 'DISCONNECTED',
    zonesCount: zonesData.features.length
  });
});

// Lancement du serveur et du bot
app.listen(PORT, async () => {
  logger.info(` Express HTTP Server listening on port ${PORT}`);
  await connectMongoDB();
  await startWhatsAppBot();
});
