/**
 * Best-guess categorization for the bulk importer.
 *
 * Two layers, in order:
 *   1. A domain lookup table - by far the most reliable signal for a bookmark, since a domain
 *      rarely lies about what kind of thing it is. Built from actually reviewing this import's
 *      real source data, not written blind.
 *   2. A generic keyword scorer against title/excerpt/url text, for anything the table doesn't
 *      cover (a future import, a domain nobody has seen yet). Lower confidence by construction.
 *
 * Nothing here is trusted blindly - scripts/import-bulk.mjs writes every result to a review
 * file with its confidence and reasoning, and only a human approval step promotes it into
 * data/links/**.
 */

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * host -> { categoryPath, tags, legalRisk? }
 *
 * Keyed on the exact registered form ("parent" or "parent/sub"); scripts/validate.mjs is the
 * final authority on whether a path actually resolves, so a typo here fails loudly rather than
 * silently mis-filing entries.
 */
const DOMAIN_RULES = {
  // --- dev-tools ---
  'it-tools.tech': { categoryPath: 'dev-tools', tags: ['utilities', 'developers'] },
  'localstack.cloud': { categoryPath: 'dev-tools', tags: ['cloud', 'local-development'] },
  'jsonpath.com': { categoryPath: 'dev-tools', tags: ['json', 'utilities'] },
  'supabase.com': { categoryPath: 'dev-tools', tags: ['backend', 'database', 'open-source'] },
  'systemrequirementslab.com': { categoryPath: 'dev-tools', tags: ['system-info'] },
  'devuan.org': { categoryPath: 'dev-tools/linux-distros-vms', tags: ['linux', 'operating-system'] },
  'osboxes.org': { categoryPath: 'dev-tools/linux-distros-vms', tags: ['virtual-machine', 'linux'] },
  'distrosea.com': { categoryPath: 'dev-tools/linux-distros-vms', tags: ['linux', 'online-demo'] },
  'distrowatch.com': { categoryPath: 'dev-tools/linux-distros-vms', tags: ['linux', 'news'] },
  'ifconfig.me': { categoryPath: 'dev-tools/networking-ip-utilities', tags: ['ip-address', 'networking'] },
  'whatismyipaddress.com': { categoryPath: 'dev-tools/networking-ip-utilities', tags: ['ip-address'] },
  'speedtest.net': { categoryPath: 'dev-tools/networking-ip-utilities', tags: ['internet-speed'] },
  'fast.com': { categoryPath: 'dev-tools/networking-ip-utilities', tags: ['internet-speed'] },
  'roadmap.sh': { categoryPath: 'dev-tools/roadmaps-references', tags: ['career', 'learning'] },
  'github.com/shpota/github-activity-generator': {
    categoryPath: 'github-repos',
    tags: ['github', 'automation'],
  },

  // --- ai-tools ---
  'thispersondoesnotexist.com': { categoryPath: 'ai-tools', tags: ['generative-ai', 'novelty'] },
  'theresanaiforthat.com': { categoryPath: 'ai-tools/ai-directories-aggregators', tags: ['ai-directory'] },
  'aixploria.com': { categoryPath: 'ai-tools/ai-directories-aggregators', tags: ['ai-directory'] },
  'futurepedia.io': { categoryPath: 'ai-tools/ai-directories-aggregators', tags: ['ai-directory'] },
  'lmarena.ai': { categoryPath: 'ai-tools/ai-directories-aggregators', tags: ['llm-benchmark'] },
  'openrouter.ai': { categoryPath: 'ai-tools/ai-directories-aggregators', tags: ['llm-routing', 'api'] },
  'composio.dev': { categoryPath: 'ai-tools/ai-directories-aggregators', tags: ['agent-tooling', 'integrations'] },
  'kimi.com': { categoryPath: 'ai-tools/ai-chat-assistants', tags: ['chatbot', 'llm'] },
  'seed.bytedance.com': { categoryPath: 'ai-tools', tags: ['research', 'llm'] },
  'utell.ai': { categoryPath: 'ai-tools', tags: ['audio', 'accent-conversion'] },
  'same.new': { categoryPath: 'ai-tools/ai-coding-agents', tags: ['website-builder', 'agent'] },
  'opencode.ai': { categoryPath: 'ai-tools/ai-coding-agents', tags: ['open-source', 'coding-agent'] },
  'hyperagent.com': { categoryPath: 'ai-tools/ai-coding-agents', tags: ['browser-agent', 'automation'] },
  'ai.upalerts.app': { categoryPath: 'ai-tools/ai-for-freelancers', tags: ['freelancing', 'upwork'] },
  'pouncer.ai': { categoryPath: 'ai-tools/ai-for-freelancers', tags: ['freelancing', 'upwork'] },
  'wordtune.com': { categoryPath: 'ai-tools/ai-writing', tags: ['writing-assistant'] },
  'quillbot.com': { categoryPath: 'ai-tools/ai-writing', tags: ['writing-assistant', 'paraphrasing'] },
  'writewithharper.com': { categoryPath: 'ai-tools/ai-writing', tags: ['writing-assistant', 'grammar'] },
  'chatgpt.com': { categoryPath: 'ai-tools/ai-chat-assistants', tags: ['chatbot', 'llm'] },
  'perplexity.ai': { categoryPath: 'ai-tools/ai-chat-assistants', tags: ['chatbot', 'search'] },
  'gemini.google.com': { categoryPath: 'ai-tools/ai-chat-assistants', tags: ['chatbot', 'llm'] },
  'z.ai': { categoryPath: 'ai-tools/ai-chat-assistants', tags: ['chatbot', 'llm'] },
  'grok.com': { categoryPath: 'ai-tools/ai-chat-assistants', tags: ['chatbot', 'llm'] },
  'chat.deepseek.com': { categoryPath: 'ai-tools/ai-chat-assistants', tags: ['chatbot', 'llm', 'open-source'] },

  // --- learning-courses ---
  'classcentral.com': { categoryPath: 'learning-courses/moocs-certifications', tags: ['mooc'] },
  'khanacademy.org': { categoryPath: 'learning-courses/moocs-certifications', tags: ['free', 'mooc'] },
  'simplilearn.com': { categoryPath: 'learning-courses/moocs-certifications', tags: ['certification'] },
  'coursera.org': { categoryPath: 'learning-courses/moocs-certifications', tags: ['mooc', 'certification'] },
  'authn.edx.org': { categoryPath: 'learning-courses/moocs-certifications', tags: ['mooc'] },
  'udemy.com': { categoryPath: 'learning-courses/moocs-certifications', tags: ['courses'] },
  'ehunar.org': { categoryPath: 'learning-courses/moocs-certifications', tags: ['pakistan', 'free'] },
  'portal.piaic.org': { categoryPath: 'learning-courses/moocs-certifications', tags: ['pakistan'] },
  'shahiduniversity.org': { categoryPath: 'learning-courses/moocs-certifications', tags: ['courses'] },
  'codanics.com': { categoryPath: 'learning-courses/data-science-programming', tags: ['data-science', 'pakistan'] },
  'datacamp.com': { categoryPath: 'learning-courses/data-science-programming', tags: ['data-science'] },
  '365datascience.com': { categoryPath: 'learning-courses/data-science-programming', tags: ['data-science'] },
  'codebasics.io': { categoryPath: 'learning-courses/data-science-programming', tags: ['data-science'] },
  'learnwith.campusx.in': { categoryPath: 'learning-courses/data-science-programming', tags: ['data-science'] },
  'freecomputerbooks.com': { categoryPath: 'learning-courses/free-books-references', tags: ['free', 'books'] },
  'blog.boot.dev': { categoryPath: 'learning-courses/free-books-references', tags: ['computer-science'] },

  // --- design-inspiration ---
  'templatemo.com': { categoryPath: 'design-inspiration', tags: ['templates', 'html-css'] },
  'noahrahm.com': { categoryPath: 'design-inspiration', tags: ['portfolio'] },
  'ibtisamkhalil.info': { categoryPath: 'design-inspiration', tags: ['portfolio'] },
  'ibtisamali.com': { categoryPath: 'design-inspiration', tags: ['portfolio'] },
  'ahmet.im': { categoryPath: 'design-inspiration', tags: ['portfolio', 'developer'] },
  'sarams-portfolio.netlify.app': { categoryPath: 'design-inspiration', tags: ['portfolio'] },
  'github.com/correct-syntax': { categoryPath: 'design-inspiration', tags: ['portfolio', 'developer'] },

  // --- productivity-utilities ---
  'monkeytype.com': { categoryPath: 'productivity-utilities', tags: ['typing-practice'] },
  'budget-track.web.app': { categoryPath: 'productivity-utilities', tags: ['budgeting', 'personal-finance'] },
  'nextcloud.com': { categoryPath: 'productivity-utilities', tags: ['file-sync', 'self-hosting', 'open-source'] },
  'bitwarden.com': { categoryPath: 'productivity-utilities', tags: ['password-manager', 'open-source'] },
  'mrfreetools.com': { categoryPath: 'productivity-utilities', tags: ['free', 'utilities'] },
  'invoice-generator.com': { categoryPath: 'productivity-utilities', tags: ['invoicing'] },
  'freeinvoicebuilder.com': { categoryPath: 'productivity-utilities', tags: ['invoicing', 'free'] },
  'textnow.com': { categoryPath: 'productivity-utilities', tags: ['calling', 'texting'] },
  'mictests.com': { categoryPath: 'productivity-utilities', tags: ['hardware-test'] },
  'mail.tm': { categoryPath: 'productivity-utilities', tags: ['temporary-email', 'privacy'] },
  'allareacodes.com': { categoryPath: 'productivity-utilities', tags: ['reference'] },
  'timeanddate.com': { categoryPath: 'productivity-utilities', tags: ['time-zones', 'reference'] },
  'filen.io': { categoryPath: 'productivity-utilities', tags: ['cloud-storage', 'privacy'] },
  'app.simplenote.com': { categoryPath: 'productivity-utilities/notes-docs', tags: ['notes'] },
  'anybox.app': { categoryPath: 'productivity-utilities/notes-docs', tags: ['bookmarking', 'mac'] },
  'joplinapp.org': { categoryPath: 'productivity-utilities/notes-docs', tags: ['notes', 'open-source'] },
  'linkace.org': { categoryPath: 'productivity-utilities/notes-docs', tags: ['bookmarking', 'self-hosting'] },
  'raindrop.io': { categoryPath: 'productivity-utilities/notes-docs', tags: ['bookmarking'] },
  'sejda.com': { categoryPath: 'productivity-utilities/pdf-file-tools', tags: ['pdf'] },
  'smallpdf.com': { categoryPath: 'productivity-utilities/pdf-file-tools', tags: ['pdf'] },
  'dictation.io': { categoryPath: 'productivity-utilities/image-text-utilities', tags: ['voice-to-text'] },
  'lingojam.com': { categoryPath: 'productivity-utilities/image-text-utilities', tags: ['text-generator'] },
  'imgbb.com': { categoryPath: 'productivity-utilities/image-text-utilities', tags: ['image-hosting'] },
  'prepostseo.com': { categoryPath: 'productivity-utilities/image-text-utilities', tags: ['ocr'] },
  'postimages.org': { categoryPath: 'productivity-utilities/image-text-utilities', tags: ['image-hosting'] },
  'app.cal.com': { categoryPath: 'productivity-utilities/screen-recording-meetings', tags: ['scheduling', 'open-source'] },
  'meet.jit.si': { categoryPath: 'productivity-utilities/screen-recording-meetings', tags: ['video-calls', 'open-source'] },
  'tella.com': { categoryPath: 'productivity-utilities/screen-recording-meetings', tags: ['screen-recording'] },
  'berrycast.com': { categoryPath: 'productivity-utilities/screen-recording-meetings', tags: ['screen-recording'] },
  'app.super-productivity.com': { categoryPath: 'productivity-utilities/task-management', tags: ['open-source'] },
  'ticktick.com': { categoryPath: 'productivity-utilities/task-management', tags: ['to-do-list'] },
  'any.do': { categoryPath: 'productivity-utilities/task-management', tags: ['to-do-list'] },
  'effectivelist.com': { categoryPath: 'productivity-utilities/task-management', tags: ['to-do-list'] },
  'cutt.ly': { categoryPath: 'productivity-utilities/url-shorteners', tags: [] },
  'dub.co': { categoryPath: 'productivity-utilities/url-shorteners', tags: ['open-source'] },

  // --- fintech-payments ---
  'forex.com.pk': { categoryPath: 'fintech-payments', tags: ['pakistan', 'exchange-rates'] },
  'stripe.com': { categoryPath: 'fintech-payments', tags: ['payments-infrastructure', 'business'] },
  'muun.com': { categoryPath: 'fintech-payments/crypto-wallets-exchanges', tags: ['bitcoin', 'wallet'] },
  'getalby.com': { categoryPath: 'fintech-payments/crypto-wallets-exchanges', tags: ['bitcoin', 'lightning'] },
  'moonpay.com': { categoryPath: 'fintech-payments/crypto-wallets-exchanges', tags: ['crypto'] },
  'strike.me': { categoryPath: 'fintech-payments/crypto-wallets-exchanges', tags: ['bitcoin'] },
  'binance.com': { categoryPath: 'fintech-payments/crypto-wallets-exchanges', tags: ['crypto-exchange'] },
  'noones.com': { categoryPath: 'fintech-payments/crypto-wallets-exchanges', tags: ['crypto-exchange', 'p2p'] },
  'redotpay.com': { categoryPath: 'fintech-payments/crypto-wallets-exchanges', tags: ['crypto-card'] },
  'trustwallet.com': { categoryPath: 'fintech-payments/crypto-wallets-exchanges', tags: ['crypto-wallet'] },
  'bybit.com': { categoryPath: 'fintech-payments/crypto-wallets-exchanges', tags: ['crypto-exchange'] },
  'walletofsatoshi.com': { categoryPath: 'fintech-payments/crypto-wallets-exchanges', tags: ['bitcoin', 'lightning'] },
  'easypaisa.com.pk': { categoryPath: 'fintech-payments/pakistan-payment-apps', tags: ['pakistan', 'mobile-wallet'] },
  'nayapay.com': { categoryPath: 'fintech-payments/pakistan-payment-apps', tags: ['pakistan', 'digital-bank'] },
  'sadapay.pk': { categoryPath: 'fintech-payments/pakistan-payment-apps', tags: ['pakistan', 'digital-bank'] },
  'zindigi.pk': { categoryPath: 'fintech-payments/pakistan-payment-apps', tags: ['pakistan', 'digital-bank'] },
  'yap.pk': { categoryPath: 'fintech-payments/pakistan-payment-apps', tags: ['pakistan', 'digital-bank'] },
  'paypro.pk': { categoryPath: 'fintech-payments/pakistan-payment-apps', tags: ['pakistan', 'payment-gateway'] },
  'wise.com': { categoryPath: 'fintech-payments/international-remittance', tags: ['remittance'] },
  'payoneer.com': { categoryPath: 'fintech-payments/international-remittance', tags: ['remittance', 'freelancers'] },
  'payeer.com': { categoryPath: 'fintech-payments/international-remittance', tags: ['e-wallet'] },
  'skrill.com': { categoryPath: 'fintech-payments/international-remittance', tags: ['e-wallet'] },
  'paypal.com': { categoryPath: 'fintech-payments/international-remittance', tags: ['e-wallet'] },
  'grey.co': { categoryPath: 'fintech-payments/international-remittance', tags: ['africa', 'remittance'] },
  'neteller.com': { categoryPath: 'fintech-payments/international-remittance', tags: ['e-wallet'] },
  'afriex.com': { categoryPath: 'fintech-payments/international-remittance', tags: ['africa', 'remittance'] },
  'nsave.com': { categoryPath: 'fintech-payments/international-remittance', tags: ['savings', 'remittance'] },

  // --- ecommerce-seller-tools ---
  'skillspanda.com': { categoryPath: 'ecommerce-seller-tools', tags: ['training'] },
  'evs.enablers.org': { categoryPath: 'ecommerce-seller-tools', tags: ['training'] },
  'login.ec.com.pk': { categoryPath: 'ecommerce-seller-tools', tags: ['pakistan', 'training'] },
  'dealspotr.com': { categoryPath: 'ecommerce-seller-tools', tags: ['deals', 'coupons'] },
  'upcitemdb.com': { categoryPath: 'ecommerce-seller-tools', tags: ['upc-lookup'] },
  'barcodelookup.com': { categoryPath: 'ecommerce-seller-tools', tags: ['barcode-lookup'] },
  'amzscout.net': { categoryPath: 'ecommerce-seller-tools', tags: ['amazon-fba'] },
  'junglescout.com': { categoryPath: 'ecommerce-seller-tools', tags: ['amazon-fba'] },
  'helium10.com': { categoryPath: 'ecommerce-seller-tools', tags: ['amazon-fba'] },
  'sellersprite.com': { categoryPath: 'ecommerce-seller-tools', tags: ['amazon-fba'] },
  'smartscout.com': { categoryPath: 'ecommerce-seller-tools', tags: ['amazon-fba', 'wholesale'] },
  'scanunlimited.com': { categoryPath: 'ecommerce-seller-tools', tags: ['amazon-fba'] },
  'selleramp.com': { categoryPath: 'ecommerce-seller-tools', tags: ['amazon-fba'] },
  'keepa.com': { categoryPath: 'ecommerce-seller-tools', tags: ['amazon-fba', 'price-tracker'] },

  // --- business-research ---
  'opencorporates.com': { categoryPath: 'business-research', tags: ['company-registry'] },
  'comptroller.texas.gov': { categoryPath: 'business-research', tags: ['company-registry', 'usa'] },
  'sitelike.org': { categoryPath: 'business-research', tags: ['competitor-research'] },
  'crunchbase.com': { categoryPath: 'business-research', tags: ['company-database', 'funding'] },
  'thomasnet.com': { categoryPath: 'business-research', tags: ['supplier-directory'] },
  'themanifest.com': { categoryPath: 'business-research', tags: ['agency-directory', 'reviews'] },
  'selectedfirms.co': { categoryPath: 'business-research', tags: ['agency-directory'] },
  'peerspot.com': { categoryPath: 'business-research', tags: ['software-reviews'] },
  'goodfirms.co': { categoryPath: 'business-research', tags: ['agency-directory', 'reviews'] },
  'clutch.co': { categoryPath: 'business-research', tags: ['agency-directory', 'reviews'] },
  'similarweb.com': { categoryPath: 'business-research', tags: ['traffic-analytics'] },
  'alternativeto.net': { categoryPath: 'business-research', tags: ['software-alternatives'] },
  'cpsglobal.org': { categoryPath: 'business-research', tags: [] },
  'itprofiles.com': { categoryPath: 'business-research', tags: ['agency-directory'] },

  // --- job-hunting-career ---
  'recrenza.com': { categoryPath: 'job-hunting-career/job-boards', tags: ['recruitment-agency'] },
  'remoteok.com': { categoryPath: 'job-hunting-career/job-boards', tags: ['remote-work'] },
  'weworkremotely.com': { categoryPath: 'job-hunting-career/job-boards', tags: ['remote-work'] },
  'bayt.com': { categoryPath: 'job-hunting-career/job-boards', tags: ['middle-east'] },
  'theladders.com': { categoryPath: 'job-hunting-career/job-boards', tags: [] },
  'wellfound.com': { categoryPath: 'job-hunting-career/job-boards', tags: ['startups'] },
  'peerlist.io': { categoryPath: 'job-hunting-career/job-boards', tags: ['tech-community', 'portfolio'] },
  'joinhandshake.com': { categoryPath: 'job-hunting-career/job-boards', tags: ['campus-recruiting'] },
  'enhancv.com': { categoryPath: 'job-hunting-career/resume-application-tools', tags: ['resume-builder'] },
  'aiapply.co': { categoryPath: 'job-hunting-career/resume-application-tools', tags: ['ai', 'resume-builder'] },
  'tealhq.com': { categoryPath: 'job-hunting-career/resume-application-tools', tags: ['resume-builder', 'job-tracker'] },

  // --- islamic-resources ---
  'quran.com': { categoryPath: 'islamic-resources/quran-hadith', tags: ['quran'] },
  'equranlibrary.com': { categoryPath: 'islamic-resources/quran-hadith', tags: ['quran'] },
  'sunnah.com': { categoryPath: 'islamic-resources/quran-hadith', tags: ['hadith'] },
  'mohaddis.com': { categoryPath: 'islamic-resources/quran-hadith', tags: ['hadith', 'urdu'] },
  'al-hadees.com': { categoryPath: 'islamic-resources/quran-hadith', tags: ['hadith', 'search-engine'] },
  'shamilaurdu.com': { categoryPath: 'islamic-resources/books-fatwa', tags: ['urdu', 'library'] },
  'kitabosunnat.com': { categoryPath: 'islamic-resources/books-fatwa', tags: ['urdu', 'library'] },
  'urdufatwa.com': { categoryPath: 'islamic-resources/books-fatwa', tags: ['urdu', 'fatwa'] },
  'australianislamiclibrary.org': { categoryPath: 'islamic-resources/books-fatwa', tags: ['library'] },

  // --- github-repos ---
  'github.com/awesome-selfhosted/awesome-selfhosted': { categoryPath: 'github-repos', tags: ['awesome-list'] },

  // --- newsletters ---
  'tldr.tech': { categoryPath: 'newsletters', tags: ['tech-news'] },
  'thenewstack.io': { categoryPath: 'newsletters', tags: ['tech-news'] },

  // --- shadow-libraries (all require legal_risk: true) ---
  'z-lib.id': { categoryPath: 'shadow-libraries/books-academic-papers', tags: ['books'], legalRisk: true },
  'libgen.li': { categoryPath: 'shadow-libraries/books-academic-papers', tags: ['books', 'academic-papers'], legalRisk: true },
  'sci-hub.se': { categoryPath: 'shadow-libraries/books-academic-papers', tags: ['academic-papers'], legalRisk: true },
  'books.ms': { categoryPath: 'shadow-libraries/books-academic-papers', tags: ['books'], legalRisk: true },
  'discudemy.com': { categoryPath: 'shadow-libraries/books-academic-papers', tags: ['courses'], legalRisk: true },
  'annas-archive.org': { categoryPath: 'shadow-libraries/books-academic-papers', tags: ['books', 'academic-papers'], legalRisk: true },
  'yts.mx': { categoryPath: 'shadow-libraries/movies-torrents', tags: ['movies', 'torrents'], legalRisk: true },
  'limetorrents.piratic.org': { categoryPath: 'shadow-libraries/movies-torrents', tags: ['torrents'], legalRisk: true },
  '1337x.to': { categoryPath: 'shadow-libraries/movies-torrents', tags: ['torrents'], legalRisk: true },
  'thepiratebay.org': { categoryPath: 'shadow-libraries/movies-torrents', tags: ['torrents'], legalRisk: true },
  'godownloads.org': { categoryPath: 'shadow-libraries/cracked-software-apks', tags: ['software'], legalRisk: true },
  'macked.app': { categoryPath: 'shadow-libraries/cracked-software-apks', tags: ['mac', 'software'], legalRisk: true },
  'appstorrent.org': { categoryPath: 'shadow-libraries/cracked-software-apks', tags: ['software'], legalRisk: true },
  'filecr.com': { categoryPath: 'shadow-libraries/cracked-software-apks', tags: ['software'], legalRisk: true },
  'getintopc.com': { categoryPath: 'shadow-libraries/cracked-software-apks', tags: ['software', 'windows'], legalRisk: true },
  'oceanofapks.com': { categoryPath: 'shadow-libraries/cracked-software-apks', tags: ['android', 'apk'], legalRisk: true },
  'liteapks.com': { categoryPath: 'shadow-libraries/cracked-software-apks', tags: ['android', 'apk'], legalRisk: true },
};

/** YouTube/archive.org lecture and Islamic-content URLs don't share one domain rule, so match
 * by keyword instead - every one of these in the source data is a Maulana Ishaq / karbala /
 * khilafat lecture. */
const LECTURE_KEYWORDS = [
  'maulana ishaq', 'molana ishaq', 'karbala', 'khurooj', 'khilafat', 'maqsad e imam',
  'maqsad e hussain', 'hazrat', 'ahlebait', 'waqia', 'jang e', 'shahadat',
  'minhaj-us-sunnat', 'mohabbat', 'se muhabbat',
];

function keywordScore(text, categoryPath, keywords) {
  const hay = text.toLowerCase();
  // Also check a hyphen-stripped variant - scraped titles spell the same word inconsistently
  // ("Khila-fat" vs "khilafat"), and a keyword list can't enumerate every such spelling.
  const hayNoHyphens = hay.replace(/-/g, '');
  return keywords.some((k) => hay.includes(k) || hayNoHyphens.includes(k.replace(/-/g, '')))
    ? categoryPath
    : null;
}

/**
 * Generic fallback for anything the domain table doesn't cover: scores a small set of
 * broad-strokes keyword rules against the combined title/excerpt/url text. Low confidence by
 * design - this exists so a future import with unseen domains still gets *a* guess to review,
 * not so it's trusted at face value.
 */
function keywordFallback({ title, excerpt, url }) {
  const text = `${title} ${excerpt} ${url}`;

  const lecture = keywordScore(text, 'islamic-resources/lectures', LECTURE_KEYWORDS);
  if (lecture) return { categoryPath: lecture, tags: ['lecture'], confidence: 'medium' };

  const rules = [
    [['job board', 'hiring', 'careers', 'vacancy'], 'job-hunting-career/job-boards'],
    [['resume', 'cv builder', 'cover letter'], 'job-hunting-career/resume-application-tools'],
    [['torrent', 'crack', 'warez'], null], // deliberately no guess - too risky to auto-guess shadow-libraries
    [['pdf'], 'productivity-utilities/pdf-file-tools'],
    [['course', 'tutorial', 'learn '], 'learning-courses/moocs-certifications'],
    [['chatbot', 'llm', 'large language model'], 'ai-tools/ai-chat-assistants'],
    [['quran', 'hadith'], 'islamic-resources/quran-hadith'],
  ];

  for (const [keywords, categoryPath] of rules) {
    if (categoryPath && keywords.some((k) => text.toLowerCase().includes(k))) {
      return { categoryPath, tags: [], confidence: 'low' };
    }
  }

  return { categoryPath: null, tags: [], confidence: 'low' };
}

/**
 * @returns {{ categoryPath: string|null, tags: string[], confidence: 'high'|'medium'|'low',
 *   legalRisk: boolean, reason: string }}
 */
export function guessCategory({ title = '', excerpt = '', url }) {
  const host = hostOf(url);

  // Some rule keys are host+path (a few GitHub profile/repo URLs need more than the bare host
  // to disambiguate), so check the longest match first.
  const pathKey = (() => {
    try {
      const u = new URL(url);
      return `${host}${u.pathname}`.replace(/\/$/, '').toLowerCase();
    } catch {
      return host;
    }
  })();

  for (const key of [pathKey, host]) {
    const rule = DOMAIN_RULES[key];
    if (rule) {
      return {
        categoryPath: rule.categoryPath,
        tags: rule.tags ?? [],
        confidence: 'high',
        legalRisk: rule.legalRisk === true,
        reason: `matched known domain "${key}"`,
      };
    }
  }

  const fallback = keywordFallback({ title, excerpt, url });
  return {
    ...fallback,
    legalRisk: false,
    reason: fallback.categoryPath
      ? 'matched a generic keyword rule - verify before approving'
      : 'no domain or keyword match - needs a manual category',
  };
}
