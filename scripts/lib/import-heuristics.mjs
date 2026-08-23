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
 * data/**.
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
  // --- technology: dev tools ---
  'it-tools.tech': { categoryPath: 'technology/dev-tools', tags: ['utilities', 'developers'] },
  'localstack.cloud': { categoryPath: 'technology/dev-tools', tags: ['cloud', 'local-development'] },
  'jsonpath.com': { categoryPath: 'technology/dev-tools', tags: ['json', 'utilities'] },
  'supabase.com': { categoryPath: 'technology/dev-tools', tags: ['backend', 'database', 'open-source'] },
  'systemrequirementslab.com': { categoryPath: 'technology/dev-tools', tags: ['system-info'] },
  'devuan.org': { categoryPath: 'technology/linux-distros-vms', tags: ['linux', 'operating-system'] },
  'osboxes.org': { categoryPath: 'technology/linux-distros-vms', tags: ['virtual-machine', 'linux'] },
  'distrosea.com': { categoryPath: 'technology/linux-distros-vms', tags: ['linux', 'online-demo'] },
  'distrowatch.com': { categoryPath: 'technology/linux-distros-vms', tags: ['linux', 'news'] },
  'ifconfig.me': { categoryPath: 'technology/networking-ip-utilities', tags: ['ip-address', 'networking'] },
  'whatismyipaddress.com': { categoryPath: 'technology/networking-ip-utilities', tags: ['ip-address'] },
  'speedtest.net': { categoryPath: 'technology/networking-ip-utilities', tags: ['internet-speed'] },
  'fast.com': { categoryPath: 'technology/networking-ip-utilities', tags: ['internet-speed'] },
  'roadmap.sh': { categoryPath: 'technology/roadmaps-references', tags: ['career', 'learning'] },
  'github.com/shpota/github-activity-generator': {
    categoryPath: 'technology/github-repos',
    tags: ['github', 'automation'],
  },

  // --- technology: ai tools ---
  'thispersondoesnotexist.com': { categoryPath: 'technology/ai-tools', tags: ['generative-ai', 'novelty'] },
  'theresanaiforthat.com': { categoryPath: 'technology/ai-directories-aggregators', tags: ['ai-directory'] },
  'aixploria.com': { categoryPath: 'technology/ai-directories-aggregators', tags: ['ai-directory'] },
  'futurepedia.io': { categoryPath: 'technology/ai-directories-aggregators', tags: ['ai-directory'] },
  'lmarena.ai': { categoryPath: 'technology/ai-directories-aggregators', tags: ['llm-benchmark'] },
  'openrouter.ai': { categoryPath: 'technology/ai-directories-aggregators', tags: ['llm-routing', 'api'] },
  'composio.dev': { categoryPath: 'technology/ai-directories-aggregators', tags: ['agent-tooling', 'integrations'] },
  'kimi.com': { categoryPath: 'technology/ai-chat-assistants', tags: ['chatbot', 'llm'] },
  'seed.bytedance.com': { categoryPath: 'technology/ai-tools', tags: ['research', 'llm'] },
  'utell.ai': { categoryPath: 'technology/ai-tools', tags: ['audio', 'accent-conversion'] },
  'same.new': { categoryPath: 'technology/ai-coding-agents', tags: ['website-builder', 'agent'] },
  'opencode.ai': { categoryPath: 'technology/ai-coding-agents', tags: ['open-source', 'coding-agent'] },
  'hyperagent.com': { categoryPath: 'technology/ai-coding-agents', tags: ['browser-agent', 'automation'] },
  'ai.upalerts.app': { categoryPath: 'technology/ai-for-freelancers', tags: ['freelancing', 'upwork'] },
  'pouncer.ai': { categoryPath: 'technology/ai-for-freelancers', tags: ['freelancing', 'upwork'] },
  'wordtune.com': { categoryPath: 'technology/ai-writing', tags: ['writing-assistant'] },
  'quillbot.com': { categoryPath: 'technology/ai-writing', tags: ['writing-assistant', 'paraphrasing'] },
  'writewithharper.com': { categoryPath: 'technology/ai-writing', tags: ['writing-assistant', 'grammar'] },
  'chatgpt.com': { categoryPath: 'technology/ai-chat-assistants', tags: ['chatbot', 'llm'] },
  'perplexity.ai': { categoryPath: 'technology/ai-chat-assistants', tags: ['chatbot', 'search'] },
  'gemini.google.com': { categoryPath: 'technology/ai-chat-assistants', tags: ['chatbot', 'llm'] },
  'z.ai': { categoryPath: 'technology/ai-chat-assistants', tags: ['chatbot', 'llm'] },
  'grok.com': { categoryPath: 'technology/ai-chat-assistants', tags: ['chatbot', 'llm'] },
  'chat.deepseek.com': { categoryPath: 'technology/ai-chat-assistants', tags: ['chatbot', 'llm', 'open-source'] },

  // --- learning: courses ---
  'classcentral.com': { categoryPath: 'learning/moocs-certifications', tags: ['mooc'] },
  'khanacademy.org': { categoryPath: 'learning/moocs-certifications', tags: ['free', 'mooc'] },
  'simplilearn.com': { categoryPath: 'learning/moocs-certifications', tags: ['certification'] },
  'coursera.org': { categoryPath: 'learning/moocs-certifications', tags: ['mooc', 'certification'] },
  'authn.edx.org': { categoryPath: 'learning/moocs-certifications', tags: ['mooc'] },
  'udemy.com': { categoryPath: 'learning/moocs-certifications', tags: ['courses'] },
  'ehunar.org': { categoryPath: 'learning/moocs-certifications', tags: ['pakistan', 'free'] },
  'portal.piaic.org': { categoryPath: 'learning/moocs-certifications', tags: ['pakistan'] },
  'shahiduniversity.org': { categoryPath: 'learning/moocs-certifications', tags: ['courses'] },
  'codanics.com': { categoryPath: 'learning/data-science-programming', tags: ['data-science', 'pakistan'] },
  'datacamp.com': { categoryPath: 'learning/data-science-programming', tags: ['data-science'] },
  '365datascience.com': { categoryPath: 'learning/data-science-programming', tags: ['data-science'] },
  'codebasics.io': { categoryPath: 'learning/data-science-programming', tags: ['data-science'] },
  'learnwith.campusx.in': { categoryPath: 'learning/data-science-programming', tags: ['data-science'] },
  'freecomputerbooks.com': { categoryPath: 'learning/free-books-references', tags: ['free', 'books'] },
  'blog.boot.dev': { categoryPath: 'learning/free-books-references', tags: ['computer-science'] },

  // --- technology: design inspiration ---
  'templatemo.com': { categoryPath: 'technology/design-inspiration', tags: ['templates', 'html-css'] },
  'noahrahm.com': { categoryPath: 'technology/design-inspiration', tags: ['portfolio'] },
  'ibtisamkhalil.info': { categoryPath: 'technology/design-inspiration', tags: ['portfolio'] },
  'ibtisamali.com': { categoryPath: 'technology/design-inspiration', tags: ['portfolio'] },
  'ahmet.im': { categoryPath: 'technology/design-inspiration', tags: ['portfolio', 'developer'] },
  'sarams-portfolio.netlify.app': { categoryPath: 'technology/design-inspiration', tags: ['portfolio'] },
  'github.com/correct-syntax': { categoryPath: 'technology/design-inspiration', tags: ['portfolio', 'developer'] },

  // --- lifestyle: productivity & utilities ---
  'monkeytype.com': { categoryPath: 'lifestyle/productivity-utilities', tags: ['typing-practice'] },
  'budget-track.web.app': { categoryPath: 'lifestyle/productivity-utilities', tags: ['budgeting', 'personal-finance'] },
  'nextcloud.com': { categoryPath: 'lifestyle/productivity-utilities', tags: ['file-sync', 'self-hosting', 'open-source'] },
  'bitwarden.com': { categoryPath: 'lifestyle/productivity-utilities', tags: ['password-manager', 'open-source'] },
  'mrfreetools.com': { categoryPath: 'lifestyle/productivity-utilities', tags: ['free', 'utilities'] },
  'invoice-generator.com': { categoryPath: 'lifestyle/productivity-utilities', tags: ['invoicing'] },
  'freeinvoicebuilder.com': { categoryPath: 'lifestyle/productivity-utilities', tags: ['invoicing', 'free'] },
  'textnow.com': { categoryPath: 'lifestyle/productivity-utilities', tags: ['calling', 'texting'] },
  'mictests.com': { categoryPath: 'lifestyle/productivity-utilities', tags: ['hardware-test'] },
  'mail.tm': { categoryPath: 'lifestyle/productivity-utilities', tags: ['temporary-email', 'privacy'] },
  'allareacodes.com': { categoryPath: 'lifestyle/productivity-utilities', tags: ['reference'] },
  'timeanddate.com': { categoryPath: 'lifestyle/productivity-utilities', tags: ['time-zones', 'reference'] },
  'filen.io': { categoryPath: 'lifestyle/productivity-utilities', tags: ['cloud-storage', 'privacy'] },
  'app.simplenote.com': { categoryPath: 'lifestyle/notes-docs', tags: ['notes'] },
  'anybox.app': { categoryPath: 'lifestyle/notes-docs', tags: ['bookmarking', 'mac'] },
  'joplinapp.org': { categoryPath: 'lifestyle/notes-docs', tags: ['notes', 'open-source'] },
  'linkace.org': { categoryPath: 'lifestyle/notes-docs', tags: ['bookmarking', 'self-hosting'] },
  'raindrop.io': { categoryPath: 'lifestyle/notes-docs', tags: ['bookmarking'] },
  'sejda.com': { categoryPath: 'lifestyle/pdf-file-tools', tags: ['pdf'] },
  'smallpdf.com': { categoryPath: 'lifestyle/pdf-file-tools', tags: ['pdf'] },
  'dictation.io': { categoryPath: 'lifestyle/image-text-utilities', tags: ['voice-to-text'] },
  'lingojam.com': { categoryPath: 'lifestyle/image-text-utilities', tags: ['text-generator'] },
  'imgbb.com': { categoryPath: 'lifestyle/image-text-utilities', tags: ['image-hosting'] },
  'prepostseo.com': { categoryPath: 'lifestyle/image-text-utilities', tags: ['ocr'] },
  'postimages.org': { categoryPath: 'lifestyle/image-text-utilities', tags: ['image-hosting'] },
  'app.cal.com': { categoryPath: 'lifestyle/screen-recording-meetings', tags: ['scheduling', 'open-source'] },
  'meet.jit.si': { categoryPath: 'lifestyle/screen-recording-meetings', tags: ['video-calls', 'open-source'] },
  'tella.com': { categoryPath: 'lifestyle/screen-recording-meetings', tags: ['screen-recording'] },
  'berrycast.com': { categoryPath: 'lifestyle/screen-recording-meetings', tags: ['screen-recording'] },
  'app.super-productivity.com': { categoryPath: 'lifestyle/task-management', tags: ['open-source'] },
  'ticktick.com': { categoryPath: 'lifestyle/task-management', tags: ['to-do-list'] },
  'any.do': { categoryPath: 'lifestyle/task-management', tags: ['to-do-list'] },
  'effectivelist.com': { categoryPath: 'lifestyle/task-management', tags: ['to-do-list'] },
  'cutt.ly': { categoryPath: 'lifestyle/url-shorteners', tags: [] },
  'dub.co': { categoryPath: 'lifestyle/url-shorteners', tags: ['open-source'] },

  // --- finance: payments ---
  'forex.com.pk': { categoryPath: 'finance/fintech-payments', tags: ['pakistan', 'exchange-rates'] },
  'stripe.com': { categoryPath: 'finance/fintech-payments', tags: ['payments-infrastructure', 'business'] },
  'muun.com': { categoryPath: 'finance/crypto-wallets-exchanges', tags: ['bitcoin', 'wallet'] },
  'getalby.com': { categoryPath: 'finance/crypto-wallets-exchanges', tags: ['bitcoin', 'lightning'] },
  'moonpay.com': { categoryPath: 'finance/crypto-wallets-exchanges', tags: ['crypto'] },
  'strike.me': { categoryPath: 'finance/crypto-wallets-exchanges', tags: ['bitcoin'] },
  'binance.com': { categoryPath: 'finance/crypto-wallets-exchanges', tags: ['crypto-exchange'] },
  'noones.com': { categoryPath: 'finance/crypto-wallets-exchanges', tags: ['crypto-exchange', 'p2p'] },
  'redotpay.com': { categoryPath: 'finance/crypto-wallets-exchanges', tags: ['crypto-card'] },
  'trustwallet.com': { categoryPath: 'finance/crypto-wallets-exchanges', tags: ['crypto-wallet'] },
  'bybit.com': { categoryPath: 'finance/crypto-wallets-exchanges', tags: ['crypto-exchange'] },
  'walletofsatoshi.com': { categoryPath: 'finance/crypto-wallets-exchanges', tags: ['bitcoin', 'lightning'] },
  'easypaisa.com.pk': { categoryPath: 'finance/pakistan-payment-apps', tags: ['pakistan', 'mobile-wallet'] },
  'nayapay.com': { categoryPath: 'finance/pakistan-payment-apps', tags: ['pakistan', 'digital-bank'] },
  'sadapay.pk': { categoryPath: 'finance/pakistan-payment-apps', tags: ['pakistan', 'digital-bank'] },
  'zindigi.pk': { categoryPath: 'finance/pakistan-payment-apps', tags: ['pakistan', 'digital-bank'] },
  'yap.pk': { categoryPath: 'finance/pakistan-payment-apps', tags: ['pakistan', 'digital-bank'] },
  'paypro.pk': { categoryPath: 'finance/pakistan-payment-apps', tags: ['pakistan', 'payment-gateway'] },
  'wise.com': { categoryPath: 'finance/international-remittance', tags: ['remittance'] },
  'payoneer.com': { categoryPath: 'finance/international-remittance', tags: ['remittance', 'freelancers'] },
  'payeer.com': { categoryPath: 'finance/international-remittance', tags: ['e-wallet'] },
  'skrill.com': { categoryPath: 'finance/international-remittance', tags: ['e-wallet'] },
  'paypal.com': { categoryPath: 'finance/international-remittance', tags: ['e-wallet'] },
  'grey.co': { categoryPath: 'finance/international-remittance', tags: ['africa', 'remittance'] },
  'neteller.com': { categoryPath: 'finance/international-remittance', tags: ['e-wallet'] },
  'afriex.com': { categoryPath: 'finance/international-remittance', tags: ['africa', 'remittance'] },
  'nsave.com': { categoryPath: 'finance/international-remittance', tags: ['savings', 'remittance'] },

  // --- career: ecommerce seller tools ---
  'skillspanda.com': { categoryPath: 'career/ecommerce-seller-tools', tags: ['training'] },
  'evs.enablers.org': { categoryPath: 'career/ecommerce-seller-tools', tags: ['training'] },
  'login.ec.com.pk': { categoryPath: 'career/ecommerce-seller-tools', tags: ['pakistan', 'training'] },
  'dealspotr.com': { categoryPath: 'career/ecommerce-seller-tools', tags: ['deals', 'coupons'] },
  'upcitemdb.com': { categoryPath: 'career/ecommerce-seller-tools', tags: ['upc-lookup'] },
  'barcodelookup.com': { categoryPath: 'career/ecommerce-seller-tools', tags: ['barcode-lookup'] },
  'amzscout.net': { categoryPath: 'career/ecommerce-seller-tools', tags: ['amazon-fba'] },
  'junglescout.com': { categoryPath: 'career/ecommerce-seller-tools', tags: ['amazon-fba'] },
  'helium10.com': { categoryPath: 'career/ecommerce-seller-tools', tags: ['amazon-fba'] },
  'sellersprite.com': { categoryPath: 'career/ecommerce-seller-tools', tags: ['amazon-fba'] },
  'smartscout.com': { categoryPath: 'career/ecommerce-seller-tools', tags: ['amazon-fba', 'wholesale'] },
  'scanunlimited.com': { categoryPath: 'career/ecommerce-seller-tools', tags: ['amazon-fba'] },
  'selleramp.com': { categoryPath: 'career/ecommerce-seller-tools', tags: ['amazon-fba'] },
  'keepa.com': { categoryPath: 'career/ecommerce-seller-tools', tags: ['amazon-fba', 'price-tracker'] },

  // --- career: business research ---
  'opencorporates.com': { categoryPath: 'career/business-research', tags: ['company-registry'] },
  'comptroller.texas.gov': { categoryPath: 'career/business-research', tags: ['company-registry', 'usa'] },
  'sitelike.org': { categoryPath: 'career/business-research', tags: ['competitor-research'] },
  'crunchbase.com': { categoryPath: 'career/business-research', tags: ['company-database', 'funding'] },
  'thomasnet.com': { categoryPath: 'career/business-research', tags: ['supplier-directory'] },
  'themanifest.com': { categoryPath: 'career/business-research', tags: ['agency-directory', 'reviews'] },
  'selectedfirms.co': { categoryPath: 'career/business-research', tags: ['agency-directory'] },
  'peerspot.com': { categoryPath: 'career/business-research', tags: ['software-reviews'] },
  'goodfirms.co': { categoryPath: 'career/business-research', tags: ['agency-directory', 'reviews'] },
  'clutch.co': { categoryPath: 'career/business-research', tags: ['agency-directory', 'reviews'] },
  'similarweb.com': { categoryPath: 'career/business-research', tags: ['traffic-analytics'] },
  'alternativeto.net': { categoryPath: 'career/business-research', tags: ['software-alternatives'] },
  'cpsglobal.org': { categoryPath: 'career/business-research', tags: [] },
  'itprofiles.com': { categoryPath: 'career/business-research', tags: ['agency-directory'] },

  // --- career: job hunting ---
  'recrenza.com': { categoryPath: 'career/job-boards', tags: ['recruitment-agency'] },
  'remoteok.com': { categoryPath: 'career/job-boards', tags: ['remote-work'] },
  'weworkremotely.com': { categoryPath: 'career/job-boards', tags: ['remote-work'] },
  'bayt.com': { categoryPath: 'career/job-boards', tags: ['middle-east'] },
  'theladders.com': { categoryPath: 'career/job-boards', tags: [] },
  'wellfound.com': { categoryPath: 'career/job-boards', tags: ['startups'] },
  'peerlist.io': { categoryPath: 'career/job-boards', tags: ['tech-community', 'portfolio'] },
  'joinhandshake.com': { categoryPath: 'career/job-boards', tags: ['campus-recruiting'] },
  'enhancv.com': { categoryPath: 'career/resume-application-tools', tags: ['resume-builder'] },
  'aiapply.co': { categoryPath: 'career/resume-application-tools', tags: ['ai', 'resume-builder'] },
  'tealhq.com': { categoryPath: 'career/resume-application-tools', tags: ['resume-builder', 'job-tracker'] },

  // --- faith: islamic resources ---
  'quran.com': { categoryPath: 'faith/quran-hadith', tags: ['quran'] },
  'equranlibrary.com': { categoryPath: 'faith/quran-hadith', tags: ['quran'] },
  'sunnah.com': { categoryPath: 'faith/quran-hadith', tags: ['hadith'] },
  'mohaddis.com': { categoryPath: 'faith/quran-hadith', tags: ['hadith', 'urdu'] },
  'al-hadees.com': { categoryPath: 'faith/quran-hadith', tags: ['hadith', 'search-engine'] },
  'shamilaurdu.com': { categoryPath: 'faith/books-fatwa', tags: ['urdu', 'library'] },
  'kitabosunnat.com': { categoryPath: 'faith/books-fatwa', tags: ['urdu', 'library'] },
  'urdufatwa.com': { categoryPath: 'faith/books-fatwa', tags: ['urdu', 'fatwa'] },
  'australianislamiclibrary.org': { categoryPath: 'faith/books-fatwa', tags: ['library'] },

  // --- technology: github repos ---
  'github.com/awesome-selfhosted/awesome-selfhosted': { categoryPath: 'technology/github-repos', tags: ['awesome-list'] },

  // --- lifestyle: newsletters ---
  'tldr.tech': { categoryPath: 'lifestyle/newsletters', tags: ['tech-news'] },
  'thenewstack.io': { categoryPath: 'lifestyle/newsletters', tags: ['tech-news'] },

  // --- shadow-library-style entries, filed by content type (all require legal_risk: true) ---
  'z-lib.id': { categoryPath: 'learning/books-academic-papers', tags: ['books'], legalRisk: true },
  'libgen.li': { categoryPath: 'learning/books-academic-papers', tags: ['books', 'academic-papers'], legalRisk: true },
  'sci-hub.se': { categoryPath: 'learning/books-academic-papers', tags: ['academic-papers'], legalRisk: true },
  'books.ms': { categoryPath: 'learning/books-academic-papers', tags: ['books'], legalRisk: true },
  'discudemy.com': { categoryPath: 'learning/books-academic-papers', tags: ['courses'], legalRisk: true },
  'annas-archive.org': { categoryPath: 'learning/books-academic-papers', tags: ['books', 'academic-papers'], legalRisk: true },
  'yts.mx': { categoryPath: 'lifestyle/movies-torrents', tags: ['movies', 'torrents'], legalRisk: true },
  'limetorrents.piratic.org': { categoryPath: 'lifestyle/movies-torrents', tags: ['torrents'], legalRisk: true },
  '1337x.to': { categoryPath: 'lifestyle/movies-torrents', tags: ['torrents'], legalRisk: true },
  'thepiratebay.org': { categoryPath: 'lifestyle/movies-torrents', tags: ['torrents'], legalRisk: true },
  'godownloads.org': { categoryPath: 'technology/cracked-software-apks', tags: ['software'], legalRisk: true },
  'macked.app': { categoryPath: 'technology/cracked-software-apks', tags: ['mac', 'software'], legalRisk: true },
  'appstorrent.org': { categoryPath: 'technology/cracked-software-apks', tags: ['software'], legalRisk: true },
  'filecr.com': { categoryPath: 'technology/cracked-software-apks', tags: ['software'], legalRisk: true },
  'getintopc.com': { categoryPath: 'technology/cracked-software-apks', tags: ['software', 'windows'], legalRisk: true },
  'oceanofapks.com': { categoryPath: 'technology/cracked-software-apks', tags: ['android', 'apk'], legalRisk: true },
  'liteapks.com': { categoryPath: 'technology/cracked-software-apks', tags: ['android', 'apk'], legalRisk: true },
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

  const lecture = keywordScore(text, 'faith/lectures', LECTURE_KEYWORDS);
  if (lecture) return { categoryPath: lecture, tags: ['lecture'], confidence: 'medium' };

  const rules = [
    [['job board', 'hiring', 'careers', 'vacancy'], 'career/job-boards'],
    [['resume', 'cv builder', 'cover letter'], 'career/resume-application-tools'],
    [['torrent', 'crack', 'warez'], null], // deliberately no guess - too risky to auto-guess a shadow-library entry
    [['pdf'], 'lifestyle/pdf-file-tools'],
    [['course', 'tutorial', 'learn '], 'learning/moocs-certifications'],
    [['chatbot', 'llm', 'large language model'], 'technology/ai-chat-assistants'],
    [['quran', 'hadith'], 'faith/quran-hadith'],
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
