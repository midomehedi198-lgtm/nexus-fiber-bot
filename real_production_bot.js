/**
 * ============================================================================
 * NEXUS-TELECOM BOT v6.5 — ROCK-SOLID PRODUCTION ENGINE
 * Robust Lead Management + 4-Tier LLM + Persistent GitHub Sync
 * ============================================================================
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const turf = require('@turf/turf');
const net = require('net');
const express = require('express');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require('@whiskeysockets/baileys');
const { askMultiTierLLM } = require('./multi_llm_engine');
const { restoreSessionFromGitHub, saveSessionToGitHub } = require('./github_session_sync');

const AUTH_DIR = process.env.AUTH_DIR || path.join(__dirname, 'auth_info_baileys');
const ADMIN_PHONE = (process.env.ADMIN_PHONE || '212625489153').replace(/\D/g, '');
const WASIT_PHONE = (process.env.WASIT_PHONE || '212699469649').replace(/\D/g, '');
const BOT_PHONE   = (process.env.BOT_PHONE   || '212699469649').replace(/\D/g, '');

const KNOWN_ADMINS = new Set([ADMIN_PHONE, WASIT_PHONE, BOT_PHONE, '220358196113553', '74415442260055']);
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const botSentIds = new Set();
const logBuffer = [];

function recordLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  logBuffer.push(line);
  if (logBuffer.length > 200) logBuffer.shift();
  logger.info(msg);
}

// ============================================================================
// 1. PERSISTENT SESSIONS
// ============================================================================
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
let sessions = {};
try {
  if (fs.existsSync(SESSIONS_FILE)) {
    sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  }
} catch (_) { sessions = {}; }

function saveSessions() {
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8'); } catch (_) {}
}

function normalizePhone(jid) {
  if (!jid) return '';
  return jid.split('@')[0].split(':')[0].replace(/\D/g, '');
}

function getSession(phone) {
  if (!sessions[phone]) {
    sessions[phone] = { step: 'IDLE', lastActivity: Date.now() };
    saveSessions();
  }
  return sessions[phone];
}

function updateSession(phone, data) {
  sessions[phone] = { ...(sessions[phone] || {}), ...data, lastActivity: Date.now() };
  saveSessions();
  return sessions[phone];
}

// ============================================================================
// 2. LOAD 2,448 REAL ZONES + SPATIAL BOUNDING-BOX INDEX
// ============================================================================
let spatialIndex = [];
try {
  const raw = fs.readFileSync(path.join(__dirname, 'zones.geojson'), 'utf8');
  const zonesData = JSON.parse(raw);
  spatialIndex = zonesData.features
    .filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
    .map(f => {
      try { return { bbox: turf.bbox(f), feature: f }; }
      catch (_) { return null; }
    })
    .filter(Boolean);
  logger.info(`✅ Loaded ${zonesData.features.length} zones. Spatial index: ${spatialIndex.length} entries.`);
} catch (e) {
  logger.error('❌ Failed to load zones.geojson: ' + e.message);
}

// ============================================================================
// 3. GIS ENGINE — BBox pre-filter + nearest-point distance
// ============================================================================
const BBOX_PAD = 1500 / 111320; // 1.5km search window

function evaluateRealCoverage(lat, lng) {
  const pt = turf.point([lng, lat]);
  const candidates = spatialIndex.filter(({ bbox }) =>
    lng >= bbox[0] - BBOX_PAD && lng <= bbox[2] + BBOX_PAD &&
    lat >= bbox[1] - BBOX_PAD && lat <= bbox[3] + BBOX_PAD
  );

  let nearestZone = null;
  let minDist = 9999999;

  for (const { feature: f } of candidates) {
    try {
      if (turf.booleanPointInPolygon(pt, f)) {
        return { status: 'DIRECT', zoneName: f.properties.name || 'المنطقة', operator: detectOp(f), distanceMeters: 0 };
      }
    } catch (_) {}
    try {
      let d;
      if (f.geometry.type === 'MultiPolygon') {
        d = Math.min(...f.geometry.coordinates.map(coords => {
          const np = turf.nearestPointOnLine(turf.polygonToLine(turf.polygon(coords)), pt);
          return turf.distance(pt, np, { units: 'meters' });
        }));
      } else {
        const np = turf.nearestPointOnLine(turf.polygonToLine(f), pt);
        d = turf.distance(pt, np, { units: 'meters' });
      }
      if (d < minDist) { minDist = d; nearestZone = f; }
    } catch (_) {
      try {
        const d = turf.distance(pt, turf.centroid(f), { units: 'meters' });
        if (d < minDist) { minDist = d; nearestZone = f; }
      } catch (_) {}
    }
  }

  const name = nearestZone?.properties?.name || 'المنطقة';
  const d = Math.round(minDist);
  const operator = nearestZone ? detectOp(nearestZone) : 'IAM / Inwi';

  if (d <= 50)  return { status: 'BUFFER_15M',   zoneName: name, operator, distanceMeters: d };
  if (d <= 300) return { status: 'PROXIMITY_90',  zoneName: name, operator, distanceMeters: d };
  if (d <= 700) return { status: 'PROXIMITY_FAR', zoneName: name, operator, distanceMeters: d };
  return { status: 'NO_COVERAGE', zoneName: name, operator: 'غير متوفر', distanceMeters: d };
}

function detectOp(f) {
  const fill = (f.properties?.fill || '').toLowerCase();
  const name = (f.properties?.name || '').toLowerCase();
  if (fill === '#00aaff' || name.includes('inwi')) return 'Inwi';
  if (name.includes('iam') || name.includes('itissalat')) return 'اتصالات المغرب (IAM)';
  return 'IAM / Inwi';
}

// ============================================================================
// 4. COORD EXTRACTOR
// ============================================================================
function extractCoords(msg) {
  const loc = msg.locationMessage || msg.liveLocationMessage;
  if (loc?.degreesLatitude) return { lat: loc.degreesLatitude, lng: loc.degreesLongitude };
  const text = (msg.conversation || msg.extendedTextMessage?.text || '').trim();
  const m1 = text.match(/[?&]q=(-?\d+\.?\d*)(?:%2C|,)(-?\d+\.?\d*)/i);
  if (m1) return { lat: +m1[1], lng: +m1[2] };
  const m2 = text.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (m2) return { lat: +m2[1], lng: +m2[2] };
  const m3 = text.match(/(-?\d{1,3}\.\d{4,})\s*[,،]\s*(-?\d{1,3}\.\d{4,})/);
  if (m3) return { lat: +m3[1], lng: +m3[2] };
  return null;
}

// ============================================================================
// 5. SEND HELPERS WITH TRIPLE FALLBACK DELIVERY
// ============================================================================
async function safeReply(sock, msg, text) {
  const rawJid = msg.key?.remoteJid;
  if (!rawJid) return null;

  try {
    await sock.sendPresenceUpdate('composing', rawJid);
    await new Promise(r => setTimeout(r, 1200));
    await sock.sendPresenceUpdate('paused', rawJid);
  } catch (_) {}

  // 1. Direct send with quoted context
  try {
    const sent = await sock.sendMessage(rawJid, { text }, { quoted: msg });
    if (sent?.key?.id) botSentIds.add(sent.key.id);
    recordLog(`✅ Delivered quoted to ${rawJid}`);
    return sent;
  } catch (e1) {
    recordLog(`⚠️ Quoted send failed to ${rawJid}: ${e1.message}`);
  }

  // 2. Direct send without quoted context
  try {
    const sent = await sock.sendMessage(rawJid, { text });
    if (sent?.key?.id) botSentIds.add(sent.key.id);
    recordLog(`✅ Delivered unquoted to ${rawJid}`);
    return sent;
  } catch (e2) {
    recordLog(`⚠️ Unquoted send failed to ${rawJid}: ${e2.message}`);
  }

  // 3. If senderPn is present (LID user phone number)
  if (msg.key?.senderPn) {
    try {
      const pnJid = `${msg.key.senderPn}@s.whatsapp.net`;
      const sent = await sock.sendMessage(pnJid, { text });
      if (sent?.key?.id) botSentIds.add(sent.key.id);
      recordLog(`✅ Delivered to senderPn ${pnJid}`);
      return sent;
    } catch (e3) {
      recordLog(`⚠️ senderPn delivery failed: ${e3.message}`);
    }
  }

  // 4. Fallback: normalized phone number JID
  const phone = normalizePhone(rawJid);
  if (phone && phone.length >= 9 && phone.length <= 15) {
    try {
      const sJid = `${phone}@s.whatsapp.net`;
      const sent = await sock.sendMessage(sJid, { text });
      if (sent?.key?.id) botSentIds.add(sent.key.id);
      recordLog(`✅ Delivered to sJid ${sJid}`);
      return sent;
    } catch (e4) {
      recordLog(`❌ All delivery methods failed for ${rawJid}: ${e4.message}`);
    }
  }
  return null;
}

async function sendNow(sock, jid, text) {
  try {
    const sent = await sock.sendMessage(jid, { text });
    if (sent?.key?.id) botSentIds.add(sent.key.id);
    return sent;
  } catch (e) {
    recordLog(`SendNow failed for ${jid}: ${e.message}`);
    return null;
  }
}

// ============================================================================
// 6. ADMIN & LEAD ALERTS
// ============================================================================
async function alertAdmins(sock, clientPhone, event) {
  const msg =
    `🔔 *إشعار زبون جديد — NEXUS TELECOM* 🔔\n\n` +
    `📞 *رقم الزبون:* +${clientPhone}\n` +
    `📋 *الحالة:* ${event}`;
  for (const r of [...new Set([ADMIN_PHONE, WASIT_PHONE])]) {
    try { await sendNow(sock, `${r}@s.whatsapp.net`, msg); }
    catch (_) {}
  }
}

async function sendLeadAlert(sock, clientPhone, name, result, lat, lng) {
  const link = `https://maps.google.com/?q=${lat},${lng}`;
  const msg =
    `🚨 *طلب اشتراك فايبر جديد مؤهل (LEAD)* 🚨\n\n` +
    `👤 *اسم الزبون:* ${name}\n` +
    `📞 *رقم هاتف الزبون:* +${clientPhone}\n` +
    `📍 *أقرب منطقة كابلاج:* ${result.zoneName}\n` +
    `📏 *المسافة من الكابل:* ${result.distanceMeters}م\n` +
    `📡 *المشغل المؤهل:* ${result.operator}\n` +
    `📊 *نوع التغطية:* ${result.status}\n` +
    `🗺️ *موقع الزبون:* ${link}\n\n` +
    `⚡ المرجو الاتصال به فوراً لتأكيد التركيب!`;

  for (const r of [...new Set([ADMIN_PHONE, WASIT_PHONE])]) {
    try {
      await sendNow(sock, `${r}@s.whatsapp.net`, msg);
      recordLog(`📨 Lead alert sent to ${r}`);
    } catch (e) {
      recordLog(`Alert failed for ${r}: ${e.message}`);
    }
  }
}

function isValidName(t) {
  if (!t || t.length < 2 || t.length > 50) return false;
  if (/https?:\/\/|www\.|📍|\+212|\+2[0-9]{11}|\d{8,}|📞|\?|؟/.test(t)) return false;
  const lower = t.toLowerCase();
  const notNames = [
    'واش', 'بشحال', 'ثمن', 'عروض', 'كونيكسيون', 'ضروري', 'روتور', 'موديم',
    'وقتاش', 'امتى', 'فين', 'سلام', 'شكرا', 'مرحبا', 'wach', 'bchhal', 'taman',
    'salam', 'slm', 'chokran', 'merci', 'hello', 'hi', 'cv'
  ];
  if (notNames.some(w => lower.includes(w))) return false;
  if ((t.match(/\n/g) || []).length > 2) return false;
  return true;
}

// ============================================================================
// 7. MESSAGE HANDLER WITH RAW JID SUPPORT (@s.whatsapp.net & @lid)
// ============================================================================
async function handleMessage(sock, msg) {
  if (!msg.message) return;
  if (botSentIds.has(msg.key?.id)) return;

  const rawJid = msg.key?.remoteJid;
  if (!rawJid) return;

  // STRICT 1-ON-1 FILTER: Ignore all groups, newsletters, status broadcasts
  if (msg.key.participant || rawJid.includes('@g.us') || rawJid.includes('@newsletter') || rawJid.includes('@broadcast') || rawJid === 'status@broadcast') {
    return;
  }
  if (msg.key.fromMe) return;

  const phone = normalizePhone(rawJid);
  if (!phone) return;

  const isAdmin = KNOWN_ADMINS.has(phone);
  const coords = extractCoords(msg.message);
  const rawText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();

  recordLog(`📥 [${phone}${isAdmin ? ' (ADMIN)' : ''}] text="${rawText.slice(0, 30)}" coords=${!!coords}`);

  const session = getSession(phone);

  // Debounced alert for new clients: at most once every 2 hours per client, never for admins
  const now = Date.now();
  if (!session.lastAlert || (now - session.lastAlert > 7200000)) {
    if (!coords && !isAdmin) {
      session.lastAlert = now;
      saveSessions();
      await alertAdmins(sock, phone, 'بدأ محادثة مع البوت');
    }
  }

  // ── CAS 1: LOCATION RECEIVED (REAL GIS 2,448 ZONES)
  if (coords) {
    const result = evaluateRealCoverage(coords.lat, coords.lng);
    updateSession(phone, { lat: coords.lat, lng: coords.lng, result, step: 'WAITING_NAME' });

    let reply;
    if (result.status === 'DIRECT') {
      reply = `🎉 *خبار زوين بزاف أخي!*\n\nالفايبر أوبتيك (*${result.operator}*) متوفر مباشرة في بقعتك (*${result.zoneName}*) ✅\n\nصيفط لينا *الاسم الكامل* ديالك دابا باش نسجلو الطلب ويتاصل بك التقني اليوم للتركيب المجاني 🚀`;
    } else if (['BUFFER_15M', 'PROXIMITY_90'].includes(result.status)) {
      reply = `👋 *أهلاً بك خويا العزيز!*\n\nموقعك قريب من شبكة الفايبر (*${result.operator}*) — أقرب كابل في *${result.zoneName}* على بعد حوالي ${result.distanceMeters}م ⚡\n\nإمكانية التوصيل للبناية ديالك واردة بنسبة 90% 📶\n\nعفاك صيفط لينا *الاسم الكامل* ديالك باش يخرج التقني يفحص البوكس ويتاصل بك! 📞`;
    } else if (result.status === 'PROXIMITY_FAR') {
      reply = `🙏 *السلام عليكم أخاي!*\n\nموقعك على بعد *${result.distanceMeters}م* من أقرب كابلاج (*${result.zoneName}*).\n\nالتغطية غير مؤكدة، خاصنا فني يفحص ميدانياً.\n\nصيفط لينا *الاسم الكامل* ديالك باش نقيدوك ونرسل فني يفحص! 📋`;
    } else {
      updateSession(phone, { step: 'IDLE' });
      reply = `للأسف أخاي، موقعك حالياً بعيد على شبكة الفايبر المتوفرة (${result.distanceMeters}م) ⏳\n\nقيدت رقمك (+${phone}) وغادي تكون أول من نعلموه إن شاء الله أول ما يدوز الكابلاج لحيكم 🙏`;
    }
    await safeReply(sock, msg, reply);
    return;
  }

  // ── CAS 2: NAME RECEIVED AFTER LOCATION
  if (session.step === 'WAITING_NAME') {
    if (!isValidName(rawText)) {
      const isQuestion = rawText.includes('?') || rawText.includes('؟') ||
        /واش|بشحال|ثمن|ضروري|روتور|موديم|وقتاش|امتى|wach|bchhal|taman/.test(rawText.toLowerCase());

      if (isQuestion) {
        const llmReply = await askMultiTierLLM(rawText);
        await safeReply(sock, msg,
          `${llmReply.text}\n\n` +
          `📌 *وباش يتاصل بك التقني ويبرمج موعد الفحص والتركيب المجاني، عفاك صيفط لينا الاسم الكامل ديالك (مثلاً: محمد أمين) 🙏*`
        );
        return;
      }

      await safeReply(sock, msg, `عفاك أخي صيفط لينا *الاسم الكامل* ديالك فقط (مثلاً: محمد العلمي) باش يسجلو التقني فالموعد 🙏`);
      return;
    }

    updateSession(phone, { name: rawText, step: 'COMPLETED' });

    const confirmMsg =
      `تم تسجيل طلبك بنجاح سي *${rawText}*! ✅\n\n` +
      `غادي يتاصل بك التقني المعتمد ديال (*${session.result?.operator || 'IAM / Inwi'}*) في أقرب وقت لتحديد موعد التركيب المجاني والروتور 🚀.\n\n` +
      `شكراً على ثقتك بنا 🤝!`;

    await safeReply(sock, msg, confirmMsg);
    await sendLeadAlert(sock, phone, rawText, session.result, session.lat, session.lng);
    recordLog(`✅ LEAD CONFIRMED: ${rawText} | +${phone} | ${session.result?.zoneName}`);
    return;
  }

  // ── CAS 3: COMPLETED SESSION
  if (session.step === 'COMPLETED') {
    const llmReply = await askMultiTierLLM(rawText);
    await safeReply(sock, msg,
      `مرحباً بك مجدداً سي *${session.name || ''}*! 😊\n\n` +
      `${llmReply.text}\n\n` +
      `📍 إلا بغيتي تفحص موقع آخر، صيفط لينا Localisation Pin جديد في أي وقت!`
    );
    return;
  }

  // ── CAS 4: INTELLIGENT MULTI-TIER LLM RESPONSE (4-TIER CASCADE)
  updateSession(phone, { step: 'WAITING_LOCATION' });
  const llmReply = await askMultiTierLLM(rawText);
  recordLog(`🤖 LLM [Tier ${llmReply.tier} - ${llmReply.provider}] answered: "${llmReply.text.slice(0, 45)}..."`);
  await safeReply(sock, msg, llmReply.text);
}

// ============================================================================
// 8. INTERNET CONNECTIVITY CHECK
// ============================================================================
function checkInternet() {
  return new Promise((resolve) => {
    const s = new net.Socket();
    s.setTimeout(3000);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error',   () => { s.destroy(); resolve(false); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.connect(53, '8.8.8.8');
  });
}

// ============================================================================
// 9. EXPRESS APP — HEALTH + QR + PAIRING CODE ENDPOINTS
// ============================================================================
const app = express();
const PORT = process.env.PORT || 3000;
let currentQR = null;
let currentSock = null;
let currentPairCode = null;
let botStatus = 'starting';

app.get('/health', (req, res) => res.json({ status: botStatus, time: new Date() }));

app.get('/logs', (req, res) => {
  res.type('text/plain').send(logBuffer.slice(-100).join('\n') || 'No logs recorded yet');
});

app.get('/code', async (req, res) => {
  if (botStatus === 'connected') {
    return res.send(`<html><body style="font-family:sans-serif;text-align:center;background:#0a0;color:#fff;padding:40px">
      <h1>✅ WhatsApp Connected!</h1><p>Bot is live and running 24/7.</p></body></html>`);
  }
  const phone = (req.query.phone || BOT_PHONE).replace(/\D/g, '');
  if (!currentSock) {
    return res.send('<html><head><meta http-equiv="refresh" content="3"></head><body style="font-family:sans-serif;text-align:center;background:#111;color:#fff;padding:40px"><h2>⏳ Starting socket... Auto-refreshing in 3s</h2></body></html>');
  }
  try {
    if (!currentPairCode) {
      currentPairCode = await currentSock.requestPairingCode(phone);
      logger.info(`🔑 PAIRING CODE GENERATED FOR +${phone}: ${currentPairCode}`);
    }
    return res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Nexus Fiber Bot — Pairing Code</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;text-align:center;background:#0d1117;color:#f0f6fc;padding:28px 16px;margin:0">
  <h2 style="color:#2ea043;margin:8px 0">🔑 كود الربط عبر رقم الهاتف (Pairing Code)</h2>
  <p style="color:#8b949e;margin:6px 0 24px 0">بدون كاميرا وبدون مسح الـ QR</p>

  <div style="background:#161b22;border:2px solid #30363d;padding:24px 32px;border-radius:16px;display:inline-block;margin:12px auto">
    <div style="font-size:14px;color:#8b949e;margin-bottom:8px">رقم هاتف البوت: +${phone}</div>
    <div style="font-size:38px;font-weight:bold;letter-spacing:6px;color:#58a6ff;font-family:monospace;background:#0d1117;padding:12px 24px;border-radius:10px;border:1px dashed #58a6ff">
      ${currentPairCode}
    </div>
  </div>

  <div style="max-width:440px;margin:24px auto;text-align:right;background:#161b22;padding:20px;border-radius:12px;border:1px solid #30363d">
    <h4 style="margin:0 0 12px 0;color:#58a6ff">📱 الخطوات في هاتف الواتساب:</h4>
    <ol style="margin:0;padding-right:20px;line-height:1.8;color:#c9d1d9">
      <li>افتح تطبيق <b>WhatsApp</b></li>
      <li>سير لـ: <b>الأجهزة المرتبطة</b> (Linked Devices) ⬅️ <b>ربط جهاز</b></li>
      <li>اضغط على <b>"ربط برقم الهاتف بدلاً من ذلك"</b> (Link with phone number instead) في الأسفل</li>
      <li>أدخل الكود الموضح أعلاه: <b style="color:#58a6ff">${currentPairCode}</b></li>
    </ol>
  </div>
</body>
</html>`);
  } catch (e) {
    res.send(`<html><head><meta http-equiv="refresh" content="4"></head><body style="font-family:sans-serif;text-align:center;background:#111;color:#fff;padding:40px">
      <h2>⏳ Refreshing connection...</h2><p>${e.message}</p></body></html>`);
  }
});

app.get('/qr', async (req, res) => {
  if (botStatus === 'connected') {
    return res.send(`<html><body style="font-family:sans-serif;text-align:center;background:#0a0;color:#fff;padding:40px">
      <h1>✅ WhatsApp Connected!</h1><p>Bot is live and running 24/7.</p></body></html>`);
  }
  if (!currentQR) {
    return res.send(`<html><head><meta http-equiv="refresh" content="3"></head>
      <body style="font-family:sans-serif;text-align:center;background:#111;color:#fff;padding:40px">
      <h2>⏳ Waiting for QR code...</h2><p>Status: ${botStatus}</p>
      <p>Auto-refreshing in 3 seconds...</p>
      <p style="margin-top:20px"><a href="/code" style="color:#58a6ff;font-size:16px;text-decoration:none">👉 أو جرب الربط بالكود (Pairing Code) من هنا</a></p>
      </body></html>`);
  }
  try {
    const qrDataUrl = await QRCode.toDataURL(currentQR, { width: 512, margin: 2 });
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Nexus Fiber Bot — WhatsApp Scan</title>
  <meta http-equiv="refresh" content="20">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;text-align:center;background:#0d1117;color:#f0f6fc;padding:24px;margin:0">
  <h2 style="margin:12px 0 6px 0;color:#2ea043">🟢 Nexus Fiber Bot — WhatsApp Link</h2>
  <p style="font-size:14px;color:#8b949e;margin:0 0 20px 0">افتح WhatsApp ⬅️ الأجهزة المرتبطة ⬅️ ربط جهاز ⬅️ وجه الكاميرا</p>
  
  <div style="background:#ffffff;padding:20px;border-radius:20px;display:inline-block;box-shadow:0 12px 40px rgba(0,0,0,0.6)">
    <img src="${qrDataUrl}" alt="WhatsApp QR Code" style="width:320px;height:320px;display:block" />
  </div>

  <div style="margin-top:24px">
    <a href="/code" style="display:inline-block;background:#238636;color:#ffffff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px">
      🔑 أو اضغط هنا للربط بالكود (Pairing Code) بدون كاميرا
    </a>
  </div>

  <p style="color:#8b949e;font-size:12px;margin:18px 0 0 0">
    ⚡ كيتجدد تلقائياً كل 20 ثانية للحفاظ على صلاحية الربط.
  </p>
</body>
</html>`);
  } catch (e) {
    res.send('QR error: ' + e.message);
  }
});

app.listen(PORT, '0.0.0.0', () => logger.info(`🌐 HTTP server listening on port ${PORT}`));

// ============================================================================
// 10. MAIN BOT LOOP WITH 100% PERSISTENT GITHUB CLOUD RESTORE
// ============================================================================
async function startBot() {
  logger.info('🚀 Nexus-Telecom Bot starting...');
  botStatus = 'connecting';

  // 1. AUTO-RESTORE SESSION FROM GITHUB CLOUD (max 3s timeout)
  if (!fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) {
    logger.info('📦 Local auth empty. Checking GitHub cloud for saved session...');
    await Promise.race([
      restoreSessionFromGitHub(AUTH_DIR),
      new Promise(r => setTimeout(r, 3000))
    ]).catch(() => {});
  }

  // Clean up any incomplete or unregistered local auth so Baileys generates a fresh QR cleanly
  const localCredsPath = path.join(AUTH_DIR, 'creds.json');
  if (fs.existsSync(localCredsPath)) {
    try {
      const c = JSON.parse(fs.readFileSync(localCredsPath, 'utf8'));
      if (!c.registered) {
        logger.warn('⚠️ Local creds exist but registered is false. Cleaning up auth dir for fresh QR...');
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      }
    } catch (_) {
      try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (_) {}
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  let waVersion;
  try {
    const v = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
    ]);
    waVersion = v?.version;
  } catch (_) {}

  const sock = makeWASocket({
    ...(waVersion ? { version: waVersion } : {}),
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['Windows', 'Chrome', '124.0.6367.82'],
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    retryRequestDelayMs: 3000,
  });
  currentSock = sock;

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    saveSessionToGitHub(AUTH_DIR).catch(() => {});
  });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      currentQR = qr;
      botStatus = 'awaiting_scan';
      logger.info('📸 Fresh QR generated — available at /qr');
    }

    if (connection === 'open') {
      currentQR = null;
      botStatus = 'connected';
      logger.info('🎉 NEXUS-TELECOM BOT IS LIVE AND CONNECTED 24/7! 🚀');
      saveSessionToGitHub(AUTH_DIR).catch(() => {});
    }

    if (connection === 'close') {
      currentPairCode = null;
      const code = lastDisconnect?.error?.output?.statusCode;
      logger.warn(`⚠️ Disconnected [${code}]. Checking connection...`);

      if (code === DisconnectReason.loggedOut || code === 403) {
        logger.warn('🔴 Logged out / 403. Refreshing auth for clean link...');
        botStatus = 'awaiting_scan';
        try {
          if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          fs.mkdirSync(AUTH_DIR, { recursive: true });
        } catch (_) {}
        setTimeout(startBot, 3000);
        return;
      }

      const delay = code === 500 ? 10000 : (code >= 400 ? 6000 : 3000);
      const hasNet = await checkInternet();
      botStatus = 'reconnecting';
      setTimeout(startBot, hasNet ? delay : 15000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      try { await handleMessage(sock, msg); }
      catch (e) { logger.error(`Handler error: ${e.message}`); }
    }
  });
}

startBot();
