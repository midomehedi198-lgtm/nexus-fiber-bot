/**
 * ============================================================================
 * NEXUS-TELECOM — MULTI-TIER LLM CASCADE ENGINE v3.0
 * ============================================================================
 * 4-Tier Zero-Fail Resilience for Moroccan Fiber Optic Sales Bot
 *
 * Tier 1: OmniRouter → openrouter/meta-llama/llama-3.3-70b-instruct (FREE, confirmed working)
 * Tier 2: OmniRouter → openrouter/meta-llama/llama-4-maverick (FREE, confirmed working)
 * Tier 3: Pollinations AI free cloud (GET endpoint, no key needed)
 * Tier 4: Deterministic Moroccan Darija Sales Shield (100% zero-fail guarantee)
 */

'use strict';
const http  = require('http');
const https = require('https');

// ─── System prompt ────────────────────────────────────────────────────────────
const DARIJA_SYSTEM_PROMPT =
`أنت مستشار مبيعات محترف متخصص في خدمات الفايبر أوبتيك بالمغرب (شركتا Inwi و IAM).
كتجاوب الزبناء بالدارجة المغربية بطريقة سلسة، ودية، ومشجعة وبإيجاز تام (3-5 جمل فقط).
جاوب على سؤال الزبون مباشرة ثم اطلب منه إرسال Localisation Pin ديالو من واتساب.
المعلومات الصحيحة:
- الفايبر ماشي ضروري يكون عند الزبون أي كونيكسيون قديم — التقني يجيب كابل الفايبر والمودم/الروتور ويركب كلشي مجانا تماما.
- 100 ميغا: 249 درهم/شهر | 200 ميغا: 349 درهم/شهر.
- الروتور واي-فاي مجاني (فابور) + التركيب مجاني 100%.
- التقني يتواصل مع الزبون خلال 24 إلى 48 ساعة بعد تأكيد الموقع.
- لا تذكر أرقام أو أسعار مختلفة عما ذكر أعلاه.`;

// ─── Helper: HTTP POST to local OmniRouter ────────────────────────────────────
function omniPost(model, userText, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: DARIJA_SYSTEM_PROMPT },
        { role: 'user',   content: userText }
      ],
      max_tokens: 400,
      temperature: 0.7
    });

    const req = http.request({
      hostname: '127.0.0.1',
      port: 20128,
      path: '/v1/chat/completions',
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'Content-Type':   'application/json',
        'Authorization':  'Bearer sk-20f66e01d86a18e2-32674e-4e58d098',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try {
          const j = JSON.parse(data);
          const content = j?.choices?.[0]?.message?.content || '';
          if (!content || content.includes('no longer supported') || content.length < 5) {
            return reject(new Error('Bad or empty content'));
          }
          resolve(content.trim());
        } catch (e) { reject(e); }
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error',   reject);
    req.write(payload);
    req.end();
  });
}

// ─── TIER 1: Llama 3.3 70B via OpenRouter (FREE, confirmed 200 OK) ───────────
function queryTier1(text) {
  return omniPost('openrouter/meta-llama/llama-3.3-70b-instruct', text, 5000);
}

// ─── TIER 2: Llama 4 Maverick via OpenRouter (FREE fallback) ─────────────────
function queryTier2(text) {
  return omniPost('openrouter/meta-llama/llama-4-maverick', text, 6000);
}

// ─── TIER 3: Pollinations AI free cloud (no key needed) ──────────────────────
function queryTier3(text, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const prompt = encodeURIComponent(
      `${DARIJA_SYSTEM_PROMPT}\n\nسؤال الزبون: ${text}\nأجب بالدارجة المغربية بإيجاز (3-5 جمل فقط):`
    );
    const req = https.get(
      `https://text.pollinations.ai/${prompt}`,
      { timeout: timeoutMs },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode !== 200 || !data || data.includes('"error":')) {
            return reject(new Error(`Pollinations HTTP ${res.statusCode}`));
          }
          const clean = data.trim()
            .replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
          if (clean.length > 5) resolve(clean);
          else reject(new Error('Response too short'));
        });
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('Pollinations timeout')); });
    req.on('error',   reject);
  });
}

// ─── TIER 4: Deterministic Darija Sales Shield (100% zero-fail) ──────────────
function queryTier4(text) {
  const t = (text || '').toLowerCase();

  if (/كونيكسيون|connexion|ضروري|قديمة|واش خاصو/.test(t)) {
    return (
      `لا أخي، ماشي ضروري نهائياً! ⚡\n\n` +
      `التقني ديالنا كيجي للدار كيدوز كابل الفايبر الجديد ويركب المودم + الروتور واي-فاي وكيخدم النت عاد تخلص فقط.\n` +
      `كلشي مجاني (تركيب + الروتور) 🎁\n\n` +
      `📍 صيفط لينا *Localisation Pin* ديالك من واتساب باش نشوفو أقرب كابل للدار ديالك!`
    );
  }

  if (/ثمن|بشحال|prix|taman|عروض|100|200|ميغا|mega/.test(t)) {
    return (
      `أفضل عروض الفايبر أوبتيك بالمغرب! 🇲🇦⚡\n\n` +
      `📶 *100 ميغا:* 249 درهم/شهر فقط\n` +
      `🚀 *200 ميغا:* 349 درهم/شهر\n` +
      `🎁 الروتور واي-فاي مجاني + التركيب مجاني 100%!\n\n` +
      `📍 صيفط لينا *Localisation Pin* ديالك باش نتأكدوا من التغطية فبلاصتك!`
    );
  }

  if (/روتور|routeur|موديم|modem|تركيب|installation|مجاني|gratuit|فابور/.test(t)) {
    return (
      `الروتور واي-فاي عالي السرعة *مجاني (فابور)* مع الاشتراك 🎁\n` +
      `والتركيب كيديرو التقني احترافياً بدون أي مقابل.\n\n` +
      `📍 صيفط لينا *Localisation Pin* ديالك باش نفحصوا التغطية في ثواني!`
    );
  }

  if (/وقتاش|امتى|متى|wqtach|technicien|تقني|موعد|rendez/.test(t)) {
    return (
      `بعد تأكيد موقعك واسمك، التقني كيتواصل معك خلال ⏱️ *24 إلى 48 ساعة* كحد أقصى باش يحدد معك الموعد المناسب للتركيب المجاني!\n\n` +
      `📍 صيفط لينا *Localisation Pin* ديالك دابا باش نبدأوا الإجراءات!`
    );
  }

  if (/تغطية|coverage|inwi|iam|اتصالات|شبكة|réseau/.test(t)) {
    return (
      `نغطي شبكتي *اتصالات المغرب (IAM)* و *إنوي (Inwi)* في أكثر من 2,448 منطقة 📡\n\n` +
      `📍 صيفط لينا *Localisation Pin* ديالك وغادي نعطيوك نتيجة التغطية فثواني!`
    );
  }

  // General greeting / unclear inquiry
  return (
    `السلام عليكم ورحمة الله! مرحباً بك في خدمة *الفايبر أوبتيك بالمغرب* 🇲🇦⚡\n\n` +
    `نغطي شبكتي IAM و Inwi — 2,448 منطقة على الخريطة الحقيقية.\n\n` +
    `📍 صيفط لينا *Localisation Pin* ديالك من واتساب وغادي نعطيوك نتيجة التغطية والعرض المناسب فثواني!`
  );
}

// ─── MASTER CASCADE FUNCTION ──────────────────────────────────────────────────
async function askMultiTierLLM(userText) {
  const t = (userText || '').toLowerCase();

  // FAQ shortcut: instant deterministic response (zero latency)
  const isFaq = /كونيكسيون|connexion|ضروري|بشحال|ثمن|100 ميغا|200 ميغا|روتور|موديم|تركيب|وقتاش|امتى|تغطية/.test(t);
  if (isFaq) {
    return { text: queryTier4(userText), tier: 4, provider: 'Instant FAQ Shield' };
  }

  // Tier 1: Llama 3.3 70B — fast, free, great Darija/Arabic
  try {
    const t1 = await queryTier1(userText);
    return { text: t1, tier: 1, provider: 'Llama 3.3 70B (OpenRouter)' };
  } catch (_) {}

  // Tier 2: Llama 4 Maverick — alternative free model
  try {
    const t2 = await queryTier2(userText);
    return { text: t2, tier: 2, provider: 'Llama 4 Maverick (OpenRouter)' };
  } catch (_) {}

  // Tier 3: Pollinations AI free cloud
  try {
    const t3 = await queryTier3(userText);
    return { text: t3, tier: 3, provider: 'Pollinations AI' };
  } catch (_) {}

  // Tier 4: Deterministic shield — never fails
  return { text: queryTier4(userText), tier: 4, provider: 'Deterministic Shield' };
}

module.exports = { askMultiTierLLM, queryTier4 };
