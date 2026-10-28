"use client";

import { useI18n } from "@/lib/i18n-provider";

// All landing-page wording, in the three dashboard languages. Kept here rather
// than in lib/i18n.ts: it is long-form marketing copy used by one page.
//
// Everything below describes features the product really has. Scene numbers
// (speed, distance, minutes) are illustrations and are labelled as such.

const en = {
  nav: { features: "Features", story: "How it works", demo: "Live demo", contact: "Contact", signin: "Sign in", demoCta: "Open live demo", menu: "Menu" },
  hero: {
    eyebrow: "GPS tracking for car rental companies",
    title1: "Every rental car.",
    title2: "Live, protected,",
    title3: "in your hands.",
    sub: "See every car on a live map, get warned the moment one leaves its zone or loses power, and stop the engine safely from your phone.",
    ctaDemo: "Open the live demo",
    ctaWatch: "See it in action",
    hudSpeed: "Speed",
    hudUpdated: "Updated",
    hudUpdatedValue: "2 s ago",
    hudHeading: "Heading",
    hudZone: "Zone",
    hudZoneValue: "Rental lot",
    demoTag: "Illustration",
    scroll: "Scroll",
  },
  stats: {
    label: "Carva Fleet in numbers",
    items: [
      { prefix: "", value: 5, unit: "s", label: "Live position updates while a car is driving" },
      { prefix: "<", value: 5, unit: "km/h", label: "Speed the car must drop below before a safe engine cut" },
      { prefix: "", value: 6, unit: "", label: "Warning types sent straight to your email" },
      { prefix: "", value: 3, unit: "", label: "Languages: English, Arabic and Kurdish" },
    ],
  },
  story: {
    eyebrow: "One drive, four moments",
    title: "What Carva does while your car is out",
    illustration: "Illustration of a real Erbil route",
    chapters: [
      { k: "01", title: "It leaves the lot", body: "A customer drives off. You watch the car move on a live map, updated every few seconds while it drives." },
      { k: "02", title: "It crosses a line", body: "It enters a zone you marked as restricted. Carva warns you at once — on the dashboard and by email." },
      { k: "03", title: "You stop it — safely", body: "You cut the engine from your phone. Carva waits until the car is slow enough, so the stop is safe." },
      { k: "04", title: "You go and get it", body: "Follow the car live and get turn-by-turn directions from where you are, right inside Carva." },
    ],
    email: { from: "Carva GPS Alerts", subject: "CRITICAL · Rental 12 entered a restricted zone", time: "now" },
    gauge: { label: "Speed", cut: "Safe engine cut", waiting: "Waiting for under 5 km/h", done: "Engine stopped" },
    route: { to: "To Rental 12", eta: "6 min", dist: "2.4 km", you: "You" },
    zone: { base: "Rental lot", restricted: "Restricted zone" },
  },
  features: {
    eyebrow: "Everything in one dashboard",
    title: "Built for the way rental companies work",
    items: [
      { t: "Live map", d: "Every car on one live map — streets, satellite or a night view, updated every few seconds." },
      { t: "Follow & directions", d: "Lock the map on a moving car and get driving directions to it from your phone." },
      { t: "Zones with rules", d: "Draw your lot, customers, repair shops and no-go areas. Decide what happens on entry or exit." },
      { t: "Remote engine cut", d: "Stop a car from anywhere, with safety guards and a full record of every command." },
      { t: "Email warnings", d: "Zone, alarm, power cut, offline and overspeed warnings — straight to your inbox." },
      { t: "Trip history", d: "Replay any day: the route, every stop, top speed and driving time." },
      { t: "Reports", d: "Distance, trips, stops and events per car, ready to export as CSV." },
      { t: "Tracker health", d: "Battery voltage, ignition and signal — know a tracker was unplugged before the car disappears." },
      { t: "Your language", d: "The whole dashboard in English, Arabic and Kurdish, on desktop and phone." },
    ],
  },
  demo: {
    eyebrow: "Try it yourself",
    title: "Drive the live map",
    body: "These cars are simulated, but they drive real Erbil streets — so you can feel how the map works. Tap a car to see its card.",
    badge: "Demo · simulated cars",
    car: "Demo car",
    moving: "Moving",
    speed: "Speed",
    open: "Open the demo dashboard",
    loading: "Loading map…",
  },
  steps: {
    eyebrow: "Getting started",
    title: "Three steps to a protected fleet",
    items: [
      { t: "Fit a tracker", d: "A small GPS tracker is installed in each car, wired to its battery." },
      { t: "Connect it to Carva", d: "The car appears on your dashboard within minutes, ready to track." },
      { t: "Watch and control", d: "Live map, zone warnings and engine cut — on desktop or phone." },
    ],
  },
  cta: {
    title: "Ready to see every car?",
    body: "Tell us about your fleet and we will set you up — or open the live demo right now.",
    demo: "Open the live demo",
    email: "Email us",
    whatsapp: "WhatsApp",
    signin: "Already a customer? Sign in",
  },
  footer: {
    tagline: "GPS tracking for car rental companies.",
    product: "Product",
    account: "Account",
    contact: "Contact",
    dashboard: "Dashboard",
    rights: "All rights reserved.",
  },
};

type Copy = typeof en;

const ar: Copy = {
  nav: { features: "المزايا", story: "كيف يعمل", demo: "عرض مباشر", contact: "تواصل", signin: "تسجيل الدخول", demoCta: "افتح العرض المباشر", menu: "القائمة" },
  hero: {
    eyebrow: "تتبّع GPS لشركات تأجير السيارات",
    title1: "كل سيارة مؤجّرة.",
    title2: "مباشرة، محمية،",
    title3: "وبين يديك.",
    sub: "شاهد كل سيارة على خريطة مباشرة، واحصل على تنبيه فور خروجها من منطقتها أو انقطاع طاقتها، وأوقف المحرك بأمان من هاتفك.",
    ctaDemo: "افتح العرض المباشر",
    ctaWatch: "شاهده يعمل",
    hudSpeed: "السرعة",
    hudUpdated: "آخر تحديث",
    hudUpdatedValue: "قبل 2 ث",
    hudHeading: "الاتجاه",
    hudZone: "المنطقة",
    hudZoneValue: "موقف التأجير",
    demoTag: "توضيح",
    scroll: "مرّر",
  },
  stats: {
    label: "كارفا فليت بالأرقام",
    items: [
      { prefix: "", value: 5, unit: "ث", label: "تحديثات الموقع المباشرة أثناء القيادة" },
      { prefix: "<", value: 5, unit: "كم/س", label: "السرعة التي يجب أن تنخفض عنها السيارة قبل القطع الآمن للمحرك" },
      { prefix: "", value: 6, unit: "", label: "أنواع تنبيهات تصل إلى بريدك مباشرة" },
      { prefix: "", value: 3, unit: "", label: "لغات: الإنجليزية والعربية والكردية" },
    ],
  },
  story: {
    eyebrow: "رحلة واحدة، أربع لحظات",
    title: "ما يفعله كارفا بينما سيارتك في الخارج",
    illustration: "توضيح لطريق حقيقي في أربيل",
    chapters: [
      { k: "01", title: "تغادر الموقف", body: "ينطلق الزبون بالسيارة. تراها تتحرك على خريطة مباشرة تتحدّث كل بضع ثوانٍ أثناء القيادة." },
      { k: "02", title: "تتجاوز الحد", body: "تدخل منطقة حدّدتها كمحظورة. ينبّهك كارفا فورًا — على لوحة التحكم وبالبريد الإلكتروني." },
      { k: "03", title: "توقفها — بأمان", body: "تقطع المحرك من هاتفك. ينتظر كارفا حتى تصبح السيارة بطيئة بما يكفي ليكون التوقف آمنًا." },
      { k: "04", title: "تذهب لاستعادتها", body: "تابع السيارة مباشرة واحصل على اتجاهات القيادة من موقعك، داخل كارفا مباشرة." },
    ],
    email: { from: "تنبيهات كارفا GPS", subject: "حرج · السيارة 12 دخلت منطقة محظورة", time: "الآن" },
    gauge: { label: "السرعة", cut: "قطع آمن للمحرك", waiting: "بانتظار سرعة أقل من 5 كم/س", done: "توقف المحرك" },
    route: { to: "إلى السيارة 12", eta: "6 د", dist: "2.4 كم", you: "أنت" },
    zone: { base: "موقف التأجير", restricted: "منطقة محظورة" },
  },
  features: {
    eyebrow: "كل شيء في لوحة واحدة",
    title: "مصمّم لطريقة عمل شركات التأجير",
    items: [
      { t: "خريطة مباشرة", d: "كل السيارات على خريطة واحدة — شوارع أو قمر صناعي أو عرض ليلي، تتحدّث كل بضع ثوانٍ." },
      { t: "التتبّع والاتجاهات", d: "ثبّت الخريطة على سيارة متحركة واحصل على اتجاهات القيادة إليها من هاتفك." },
      { t: "مناطق بقواعد", d: "ارسم موقفك وزبائنك وورش التصليح والمناطق الممنوعة، وقرّر ما يحدث عند الدخول أو الخروج." },
      { t: "قطع المحرك عن بُعد", d: "أوقف السيارة من أي مكان، مع ضوابط أمان وسجل كامل لكل أمر." },
      { t: "تنبيهات بالبريد", d: "تنبيهات المناطق والإنذارات وانقطاع الطاقة وفقدان الاتصال وتجاوز السرعة — إلى بريدك مباشرة." },
      { t: "سجل الرحلات", d: "أعد تشغيل أي يوم: المسار وكل توقف وأعلى سرعة ووقت القيادة." },
      { t: "التقارير", d: "المسافة والرحلات والتوقفات والأحداث لكل سيارة، جاهزة للتصدير بصيغة CSV." },
      { t: "صحة جهاز التتبّع", d: "جهد البطارية والإشعال والإشارة — اعرف أن الجهاز فُصل قبل أن تختفي السيارة." },
      { t: "بلغتك", d: "لوحة التحكم كاملة بالإنجليزية والعربية والكردية، على الحاسوب والهاتف." },
    ],
  },
  demo: {
    eyebrow: "جرّبه بنفسك",
    title: "قُد الخريطة المباشرة",
    body: "هذه السيارات محاكاة، لكنها تسير في شوارع أربيل الحقيقية — لتشعر بكيفية عمل الخريطة. اضغط على سيارة لرؤية بطاقتها.",
    badge: "عرض · سيارات محاكاة",
    car: "سيارة تجريبية",
    moving: "تتحرك",
    speed: "السرعة",
    open: "افتح لوحة التحكم التجريبية",
    loading: "جارٍ تحميل الخريطة…",
  },
  steps: {
    eyebrow: "البدء",
    title: "ثلاث خطوات لأسطول محمي",
    items: [
      { t: "ركّب جهاز تتبّع", d: "يُركَّب جهاز GPS صغير في كل سيارة، موصول ببطاريتها." },
      { t: "اربطه بكارفا", d: "تظهر السيارة على لوحتك خلال دقائق، جاهزة للتتبّع." },
      { t: "راقب وتحكّم", d: "خريطة مباشرة وتنبيهات المناطق وقطع المحرك — على الحاسوب أو الهاتف." },
    ],
  },
  cta: {
    title: "مستعد لرؤية كل سيارة؟",
    body: "أخبرنا عن أسطولك وسنجهّز لك كل شيء — أو افتح العرض المباشر الآن.",
    demo: "افتح العرض المباشر",
    email: "راسلنا بالبريد",
    whatsapp: "واتساب",
    signin: "عميل بالفعل؟ سجّل الدخول",
  },
  footer: {
    tagline: "تتبّع GPS لشركات تأجير السيارات.",
    product: "المنتج",
    account: "الحساب",
    contact: "تواصل",
    dashboard: "لوحة التحكم",
    rights: "جميع الحقوق محفوظة.",
  },
};

const ckb: Copy = {
  nav: { features: "تایبەتمەندییەکان", story: "چۆن کار دەکات", demo: "نمایشی ڕاستەوخۆ", contact: "پەیوەندی", signin: "چوونەژوورەوە", demoCta: "نمایشی ڕاستەوخۆ بکەرەوە", menu: "مێنیو" },
  hero: {
    eyebrow: "بەدواداچوونی GPS بۆ کۆمپانیاکانی بەکرێدانی ئۆتۆمبێل",
    title1: "هەموو ئۆتۆمبێلێکی بەکرێدراو.",
    title2: "ڕاستەوخۆ، پارێزراو،",
    title3: "لە دەستی تۆدا.",
    sub: "هەموو ئۆتۆمبێلێک لەسەر نەخشەیەکی ڕاستەوخۆ ببینە، کاتێک لە ناوچەکەی دەردەچێت یان کارەبای دەبڕێت یەکسەر ئاگادار بکرێیتەوە، و بزوێنەرەکە بە سەلامەتی لە مۆبایلەکەتەوە بوەستێنە.",
    ctaDemo: "نمایشی ڕاستەوخۆ بکەرەوە",
    ctaWatch: "ببینە چۆن کار دەکات",
    hudSpeed: "خێرایی",
    hudUpdated: "نوێکرایەوە",
    hudUpdatedValue: "پێش 2 چرکە",
    hudHeading: "ئاراستە",
    hudZone: "ناوچە",
    hudZoneValue: "شوێنی بەکرێدان",
    demoTag: "وێنەکێشان",
    scroll: "بخولێنەوە",
  },
  stats: {
    label: "کارڤا فلیت بە ژمارە",
    items: [
      { prefix: "", value: 5, unit: "چ", label: "نوێکردنەوەی شوێنی ڕاستەوخۆ لە کاتی لێخوڕیندا" },
      { prefix: "<", value: 5, unit: "کم/ک", label: "ئەو خێراییەی ئۆتۆمبێل دەبێت لێی کەمتر بێت پێش بڕینی سەلامەتی بزوێنەر" },
      { prefix: "", value: 6, unit: "", label: "جۆرە ئاگادارییەکان ڕاستەوخۆ بۆ ئیمەیڵەکەت" },
      { prefix: "", value: 3, unit: "", label: "زمانەکان: ئینگلیزی، عەرەبی و کوردی" },
    ],
  },
  story: {
    eyebrow: "یەک گەشت، چوار ساتەوەخت",
    title: "کارڤا چی دەکات کاتێک ئۆتۆمبێلەکەت لە دەرەوەیە",
    illustration: "وێنەی ڕێگایەکی ڕاستەقینەی هەولێر",
    chapters: [
      { k: "01", title: "شوێنەکە جێدەهێڵێت", body: "کڕیارێک ئۆتۆمبێلەکە دەبات. تۆ دەیبینیت لەسەر نەخشەیەکی ڕاستەوخۆ دەجووڵێت، هەر چەند چرکەیەک نوێ دەبێتەوە." },
      { k: "02", title: "سنوورێک دەبەزێنێت", body: "دەچێتە ناوچەیەک کە تۆ قەدەغەت کردووە. کارڤا یەکسەر ئاگادارت دەکاتەوە — لە داشبۆرد و بە ئیمەیڵ." },
      { k: "03", title: "دەیوەستێنیت — بە سەلامەتی", body: "بزوێنەرەکە لە مۆبایلەکەتەوە دەبڕیت. کارڤا چاوەڕێ دەکات تا ئۆتۆمبێلەکە بەس هێواش بێت، بۆ ئەوەی وەستانەکە سەلامەت بێت." },
      { k: "04", title: "دەچیت بیهێنیتەوە", body: "شوێنی ئۆتۆمبێلەکە بکەوە بە ڕاستەوخۆ و ڕێنمایی ڕێگا وەربگرە لە شوێنەکەی خۆتەوە، لە ناو کارڤادا." },
    ],
    email: { from: "ئاگادارییەکانی کارڤا GPS", subject: "مەترسیدار · ئۆتۆمبێلی 12 چووە ناوچەیەکی قەدەغە", time: "ئێستا" },
    gauge: { label: "خێرایی", cut: "بڕینی سەلامەتی بزوێنەر", waiting: "چاوەڕێی کەمتر لە 5 کم/کاتژمێر", done: "بزوێنەر وەستا" },
    route: { to: "بۆ ئۆتۆمبێلی 12", eta: "6 خولەک", dist: "2.4 کم", you: "تۆ" },
    zone: { base: "شوێنی بەکرێدان", restricted: "ناوچەی قەدەغە" },
  },
  features: {
    eyebrow: "هەموو شتێک لە یەک داشبۆرددا",
    title: "دروستکراوە بۆ شێوازی کاری کۆمپانیاکانی بەکرێدان",
    items: [
      { t: "نەخشەی ڕاستەوخۆ", d: "هەموو ئۆتۆمبێلەکان لەسەر یەک نەخشە — شەقام، مانگی دەستکرد یان دیمەنی شەو، هەر چەند چرکەیەک نوێ دەبێتەوە." },
      { t: "شوێنکەوتن و ڕێنمایی", d: "نەخشەکە لەسەر ئۆتۆمبێلێکی جووڵاو قفڵ بکە و ڕێنمایی لێخوڕین وەربگرە بۆی." },
      { t: "ناوچە بە یاسا", d: "شوێنەکەت، کڕیاران، پیشەسازی و ناوچە قەدەغەکان بکێشە. بڕیار بدە چی ڕوودەدات لە چوونەژوورەوە یان دەرچوون." },
      { t: "بڕینی بزوێنەر لە دوورەوە", d: "ئۆتۆمبێلێک لە هەر شوێنێکەوە بوەستێنە، لەگەڵ پاسەوانی سەلامەتی و تۆمارێکی تەواوی هەموو فەرمانێک." },
      { t: "ئاگاداری بە ئیمەیڵ", d: "ئاگادارییەکانی ناوچە، ئاگادارکەرەوە، بڕانی کارەبا، لە هێڵ نەبوون و خێرایی زیاد — ڕاستەوخۆ بۆ ئیمەیڵەکەت." },
      { t: "مێژووی گەشت", d: "هەر ڕۆژێک دووبارە ببینەوە: ڕێگاکە، هەموو وەستانێک، بەرزترین خێرایی و کاتی لێخوڕین." },
      { t: "ڕاپۆرتەکان", d: "مەودا، گەشت، وەستان و ڕووداوەکان بۆ هەر ئۆتۆمبێلێک، ئامادەی هەناردە بە CSV." },
      { t: "تەندروستی تراکەر", d: "ڤۆڵتی پاتری، داگیرساندن و سیگناڵ — بزانە تراکەرەکە لابراوە پێش ئەوەی ئۆتۆمبێلەکە ون بێت." },
      { t: "بە زمانی خۆت", d: "تەواوی داشبۆردەکە بە ئینگلیزی، عەرەبی و کوردی، لەسەر کۆمپیوتەر و مۆبایل." },
    ],
  },
  demo: {
    eyebrow: "خۆت تاقی بکەوە",
    title: "نەخشەی ڕاستەوخۆ بەکاربهێنە",
    body: "ئەم ئۆتۆمبێلانە لاسایی کراونەتەوە، بەڵام لە شەقامە ڕاستەقینەکانی هەولێردا دەڕۆن — بۆ ئەوەی هەست بکەیت نەخشەکە چۆن کار دەکات. لەسەر ئۆتۆمبێلێک دابگرە بۆ بینینی کارتەکەی.",
    badge: "نمایش · ئۆتۆمبێلی لاساییکراوە",
    car: "ئۆتۆمبێلی نمایش",
    moving: "لە جووڵەدایە",
    speed: "خێرایی",
    open: "داشبۆردی نمایشی بکەرەوە",
    loading: "نەخشە بار دەکرێت…",
  },
  steps: {
    eyebrow: "دەستپێکردن",
    title: "سێ هەنگاو بۆ فلیتێکی پارێزراو",
    items: [
      { t: "تراکەرێک دابنێ", d: "تراکەرێکی GPS ی بچووک لە هەر ئۆتۆمبێلێکدا دادەنرێت، بە پاترییەکەیەوە بەستراوە." },
      { t: "بە کارڤاوە بیبەستەوە", d: "ئۆتۆمبێلەکە لە ماوەی چەند خولەکێکدا لەسەر داشبۆردەکەت دەردەکەوێت، ئامادەی بەدواداچوون." },
      { t: "چاودێری و کۆنتڕۆڵ بکە", d: "نەخشەی ڕاستەوخۆ، ئاگاداریی ناوچە و بڕینی بزوێنەر — لەسەر کۆمپیوتەر یان مۆبایل." },
    ],
  },
  cta: {
    title: "ئامادەیت هەموو ئۆتۆمبێلێک ببینیت؟",
    body: "دەربارەی فلیتەکەت پێمان بڵێ و هەموو شتێکت بۆ ئامادە دەکەین — یان ئێستا نمایشی ڕاستەوخۆ بکەرەوە.",
    demo: "نمایشی ڕاستەوخۆ بکەرەوە",
    email: "ئیمەیڵمان بۆ بنێرە",
    whatsapp: "واتسئاپ",
    signin: "پێشتر کڕیاریت؟ بچۆ ژوورەوە",
  },
  footer: {
    tagline: "بەدواداچوونی GPS بۆ کۆمپانیاکانی بەکرێدانی ئۆتۆمبێل.",
    product: "بەرهەم",
    account: "هەژمار",
    contact: "پەیوەندی",
    dashboard: "داشبۆرد",
    rights: "هەموو مافەکان پارێزراون.",
  },
};

const COPY = { en, ar, ckb } as const;

export function useLandingCopy(): Copy & { dir: "ltr" | "rtl" } {
  const { locale, dir } = useI18n();
  return { ...(COPY[locale] ?? en), dir };
}
