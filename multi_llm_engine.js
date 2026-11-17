'use strict';

// Local replies have no API cost and never transmit customer messages to an LLM.
const LOCATION = '📍 صيفط لينا موقع الدار من WhatsApp: المرفقات 📎 ← الموقع ← إرسال موقعك الحالي. إلا ما كنتيش فالدار، صيفط النقطة ديال الدار من الخريطة.';

function classify(text) {
  const t = String(text || '').normalize('NFKC').toLowerCase().trim();
  if (/بشري|مسؤول|موظف|شي واحد|هضر مع|اتصل بي|عيط ليا|شكاية|مشكل|مافهمت|ما فهمت|مفهمتش|agent|humain|conseiller|rappelle|reclamation|réclamation|ما جاوبت|ماجاوبت|mabghitch|mafhemt|ma fhemt|3iyet|3ayet/.test(t)) return 'handoff';
  if (/بشحال|شحال|ثمن|سعر|عروض|taman|prix|offre|combien|bchhal|bch7al|flous|\b(?:100|200)\b|ميغا|mega/.test(t)) return 'pricing';
  if (/روتور|راوتر|موديم|تركيب|مجاني|فابور|routeur|router|modem|installation|gratuit/.test(t)) return 'installation';
  if (/وقتاش|امتى|متى|موعد|تقني|wqtach|technicien|rendez/.test(t)) return 'timing';
  if (/عقد|وثائق|بطاقة|التزام|الغاء|إلغاء|contrat|document|engagement|résili|resili/.test(t)) return 'contract';
  if (/adsl|كونيكسيون|connexion|قديمة|واش خاصو/.test(t)) return 'existing';
  if (/تغطية|شبكة|اتصالات|واصل|كاين|فايبر|فيبر|موقع|لوكيشن|fibre|fiber|coverage|inwi|iam|orange|réseau|reseau|localisation|position|location/.test(t)) return 'coverage';
  if (/^(?:سلام(?: عليكم)?|السلام عليكم(?: ورحمة الله)?|مرحبا|أهلا|اهلا|لاباس|شكرا|slm|salam|salut|hello|hi|bonjour|marhaba|cv|labas|merci|chokran)[\s!?؟،.]*$/u.test(t)) return 'greeting';
  return 'unknown';
}

function replyFor(intent) {
  switch (intent) {
    case 'pricing': return `📶 *عروض الفايبر*\n\nالأثمنة المذكورة فالعروض ديالنا: 100 ميغا بـ *249 درهم/الشهر*، و200 ميغا بـ *349 درهم/الشهر*. خاص المسؤول يأكد ليك العرض الحالي والمصاريف والشروط حسب المشغل والعنوان قبل الاشتراك.\n\n${LOCATION}`;
    case 'installation': return `🛠️ *الروتور والتركيب*\n\nالإعفاء من مصاريف الروتور والتركيب كيتحدد حسب العرض وشروط المشغل. المسؤول كيأكد ليك التفاصيل قبل أي التزام.\n\n${LOCATION}`;
    case 'timing': return `🗓️ *موعد التركيب*\n\nمن بعد التحقق من التغطية، المسؤول كيتواصل معاك لتأكيد الشروط والموعد المتاح. ما نقدرش نضمن نهار التركيب قبل تأكيد المشغل.\n\n${LOCATION}`;
    case 'contract': return '📋 *شروط الاشتراك*\n\nمدة الالتزام والوثائق والمصاريف كتختلف حسب المشغل والعرض. غادي نحوّل سؤالك للمسؤول باش يعطيك التفاصيل المؤكدة قبل ما تقرر.';
    case 'existing': return `ماشي ضروري تكون عندك خدمة ADSL قديمة باش نراجعو إمكانية الاشتراك فالفايبر. القبول كيبقى حسب العنوان وشروط المشغل.\n\n${LOCATION}`;
    case 'coverage': return `📡 نقدر ندير ليك فحص أولي للتغطية حسب الخريطة المتوفرة ديال IAM وInwi. التأكيد النهائي كيديرو المشغل؛ القرب من منطقة فالخريطة بوحدو ما كيضمنش الربط.\n\n${LOCATION}`;
    case 'greeting': return `مرحبا بيك 👋\nأنا المساعد الآلي ديال *Nexus Fiber*. نعاونك تعرف العروض وتفحص التغطية الأولية، وتقدر تطلب المسؤول فأي وقت.\n\n${LOCATION}`;
    case 'handoff': return 'فهمتك 🤝 غادي نحاول نحوّل طلبك للمسؤول باش يتابع معاك مباشرة.';
    default: return 'باش ما نعطيكش معلومة غير مؤكدة، غادي نحاول نحوّل سؤالك للمسؤول 🤝\n\nنقدر نعاونك دابا فالعروض، الروتور والتركيب، أو فحص التغطية. كتب ليا شنو محتاج.';
  }
}

function queryTier4(text) { return replyFor(classify(text)); }

async function askMultiTierLLM(userText) {
  const intent = classify(userText);
  return {
    text: replyFor(intent), intent, tier: 4, provider: 'Local Darija replies',
    needsHuman: ['unknown', 'handoff', 'contract'].includes(intent)
  };
}

module.exports = { askMultiTierLLM, queryTier4, classify };
