import { writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT } from './yaml-io.mjs';

/**
 * Build-time enrichment: favicon, cover image, title, and description, all fetched once and
 * cached (or backfilled into the YAML), never fetched live at visitor page-load time.
 *
 * Pages must never call out to a third party at runtime - an entry's icon and cover image are
 * fetched once here, saved into site/public/favicons/<kind>/<slug>.<ext> and
 * site/public/covers/<kind>/<slug>.<ext>, committed to git like any other data file, and served
 * from the same origin as the rest of the site from then on. Favicon.astro/Cover.astro fall back
 * to a letter initial / nothing when no cached file exists for a slug.
 *
 * Namespaced by kind (links/companies) because slugs are only unique WITHIN a collection - a link
 * and a company may legitimately share a slug, and they almost certainly have different assets.
 *
 * `enrichEntry` is the single-fetch entry point used at add-time (local CLIs, the issue-form
 * pipeline): one HTTP request for the page's <head> feeds the favicon, cover, title, and
 * description extraction all at once, rather than fetching the same page multiple times.
 * `fetchFaviconForEntry` remains a standalone favicon-only fetch for the bulk backfill pass
 * (scripts/fetch-favicons.mjs), which runs over the whole dataset and has no use for title/
 * description there.
 */

const FAVICONS_ROOT = path.join(REPO_ROOT, 'site', 'public', 'favicons');
const COVERS_ROOT = path.join(REPO_ROOT, 'site', 'public', 'covers');

const USER_AGENT = 'sidequest-favicon-fetcher/1.0 (+https://github.com/ibtisam-iq/sidequest)';
const FETCH_TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 300 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 300;

/** Every extension this module might have written, in no particular order. */
export const KNOWN_EXTENSIONS = ['svg', 'png', 'ico', 'jpg', 'gif', 'webp'];

function assetDir(root, kind) {
  return path.join(root, kind);
}

async function cachedExtIn(root, kind, slug) {
  let entries;
  try {
    entries = await readdir(assetDir(root, kind));
  } catch {
    return null;
  }
  for (const name of entries) {
    const ext = path.extname(name).slice(1);
    // Basename must equal slug exactly - "warp" must not match a file named "warp-2.png".
    if (ext && name.slice(0, name.length - ext.length - 1) === slug) return ext;
  }
  return null;
}

/** The cached favicon's extension for a slug, or null if nothing is cached yet. */
export async function cachedFaviconExt(kind, slug) {
  return cachedExtIn(FAVICONS_ROOT, kind, slug);
}

/** The cached cover image's extension for a slug, or null if nothing is cached yet. */
export async function cachedCoverExt(kind, slug) {
  return cachedExtIn(COVERS_ROOT, kind, slug);
}

async function withTimeout(signalConsumer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await signalConsumer(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches just enough of the page to find <link rel="icon"> and <meta> tags, capped at
 * MAX_HTML_BYTES so a huge page doesn't get downloaded in full just to read its <head>.
 */
async function fetchHtmlHead(url) {
  return withTimeout(async (signal) => {
    let res;
    try {
      res = await fetch(url, {
        signal,
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
      });
    } catch {
      return null;
    }
    if (!res.ok || !res.body) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    let received = 0;

    try {
      while (received < MAX_HTML_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        html += decoder.decode(value, { stream: true });
        if (/<\/head>/i.test(html)) break;
      }
    } finally {
      reader.cancel().catch(() => {});
    }

    return { html, finalUrl: res.url || url };
  }).catch(() => null);
}

/** Rough score so a real PNG/SVG icon wins over a bare 16x16 .ico when both exist. */
function scoreIconTag(rel, type, sizes) {
  let score = 0;
  if (/\bicon\b/i.test(rel)) score += 10;
  if (/apple-touch-icon/i.test(rel)) score += 5;
  if (/svg/i.test(type)) score += 50;
  else if (/png/i.test(type)) score += 30;
  else if (/jpe?g/i.test(type)) score += 10;

  const size = parseInt((sizes || '').split('x')[0], 10);
  if (Number.isFinite(size)) score += Math.min(size, 512) / 10;
  else if (/any/i.test(sizes || '')) score += 40;

  return score;
}

/** Every <link rel="...icon..."> candidate in the head, best first. */
function extractIconCandidates(html, baseUrl) {
  const candidates = [];
  const linkTagRe = /<link\b[^>]*>/gi;
  let match;

  while ((match = linkTagRe.exec(html))) {
    const tag = match[0];
    const rel = (/rel=["']?([^"'\s>]+(?:\s+[^"'\s>]+)*)/i.exec(tag) || [])[1] || '';
    if (!/icon/i.test(rel)) continue;

    const href = (/href=["']([^"']+)["']/i.exec(tag) || [])[1];
    if (!href) continue;

    const type = (/type=["']([^"']+)["']/i.exec(tag) || [])[1] || '';
    const sizes = (/sizes=["']([^"']+)["']/i.exec(tag) || [])[1] || '';

    let resolved;
    try {
      resolved = new URL(href, baseUrl).href;
    } catch {
      continue;
    }

    candidates.push({ url: resolved, score: scoreIconTag(rel, type, sizes) });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

/**
 * Extracts one attribute's value from an HTML tag, quote-aware - a naive `[^"']*` capture (the
 * previous approach here) truncates at the FIRST apostrophe inside a double-quoted value, which
 * is common enough in real og:description text ("a workspace that doesn't...") to matter.
 */
function extractAttr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const found = re.exec(tag);
  return found ? (found[1] ?? found[2] ?? '').trim() : '';
}

/** Pulls one <meta> tag's content by name or property, case-insensitively. */
function extractMetaContent(html, key) {
  const metaTagRe = /<meta\b[^>]*>/gi;
  let match;
  while ((match = metaTagRe.exec(html))) {
    const tag = match[0];
    const nameAttr = extractAttr(tag, 'name') || extractAttr(tag, 'property');
    if (nameAttr.toLowerCase() === key.toLowerCase()) return extractAttr(tag, 'content');
  }
  return '';
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

function truncate(text, max) {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}...` : trimmed;
}

/** Best-effort title/description/social-image extraction from a page's <head>. */
export function extractMeta(html, baseUrl) {
  const ogTitle = decodeEntities(extractMetaContent(html, 'og:title'));
  const titleTag = decodeEntities((/<title\b[^>]*>([^<]*)<\/title>/i.exec(html) || [])[1] || '');
  // og:title is usually the cleaner, more concise choice when a page sets both - a <title> tag
  // routinely carries an SEO tail ("Ghostty - Fast, native, GPU-accelerated terminal | Ghostty").
  const rawTitle = ogTitle || titleTag;

  const ogDescription = decodeEntities(extractMetaContent(html, 'og:description'));
  const metaDescription = decodeEntities(extractMetaContent(html, 'description'));
  const rawDescription = ogDescription || metaDescription;

  const rawImage = extractMetaContent(html, 'og:image');
  let imageUrl;
  if (rawImage) {
    try {
      imageUrl = new URL(rawImage, baseUrl).href;
    } catch {
      imageUrl = undefined;
    }
  }

  return {
    title: rawTitle ? truncate(rawTitle, TITLE_MAX) : undefined,
    description: rawDescription ? truncate(rawDescription, DESCRIPTION_MAX) : undefined,
    imageUrl,
  };
}

function extFromContentType(contentType) {
  const type = (contentType || '').split(';')[0].trim().toLowerCase();
  return (
    {
      'image/svg+xml': 'svg',
      'image/png': 'png',
      'image/x-icon': 'ico',
      'image/vnd.microsoft.icon': 'ico',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
    }[type] ?? null
  );
}

/** Falls back to sniffing magic bytes when a server sends the wrong (or no) content-type. */
function extFromMagicBytes(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'gif';
  if (buf.length >= 4 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'ico';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  const head = buf.toString('utf8', 0, Math.min(buf.length, 256)).trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'svg';
  return null;
}

/** Downloads one candidate image. Returns null on any failure - a bad candidate is just skipped. */
async function downloadImage(url) {
  return withTimeout(async (signal) => {
    let res;
    try {
      res = await fetch(url, { signal, redirect: 'follow', headers: { 'User-Agent': USER_AGENT } });
    } catch {
      return null;
    }
    if (!res.ok) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;

    const ext = extFromContentType(res.headers.get('content-type')) ?? extFromMagicBytes(buf);
    return ext ? { buf, ext } : null;
  }).catch(() => null);
}

/** Writes an already-downloaded image to `root/kind/slug.ext`. */
async function saveAsset(root, kind, slug, buf, ext) {
  await mkdir(assetDir(root, kind), { recursive: true });
  await writeFile(path.join(assetDir(root, kind), `${slug}.${ext}`), buf);
}

/** Downloads one URL and caches it directly as a slug's cover image - no candidate scoring. */
export async function cacheCoverFromUrl(kind, slug, imageUrl, { force = false } = {}) {
  if (!force) {
    const existing = await cachedCoverExt(kind, slug);
    if (existing) return { status: 'skipped', ext: existing };
  }
  const downloaded = await downloadImage(imageUrl);
  if (!downloaded) return { status: 'failed', reason: 'could not download the image' };
  await saveAsset(COVERS_ROOT, kind, slug, downloaded.buf, downloaded.ext);
  return { status: 'saved', ext: downloaded.ext };
}

/**
 * Fetches and caches the favicon for one entry.
 *
 * @param kind   'links' | 'companies'
 * @param slug   the entry's filename without extension
 * @param url    the entry's url (links) or website (companies)
 * @param force  refetch even if a cached file already exists
 * @returns {Promise<{status: 'saved'|'skipped'|'failed', ext?: string, reason?: string}>}
 */
export async function fetchFaviconForEntry(kind, slug, url, { force = false } = {}) {
  if (!force) {
    const existing = await cachedFaviconExt(kind, slug);
    if (existing) return { status: 'skipped', ext: existing };
  }

  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return { status: 'failed', reason: 'entry URL is not a valid absolute URL' };
  }

  const head = await fetchHtmlHead(url);
  const candidates = head ? extractIconCandidates(head.html, head.finalUrl) : [];
  candidates.push({ url: `${origin}/favicon.ico`, score: -1 });

  let downloaded = null;
  for (const candidate of candidates.slice(0, 4)) {
    downloaded = await downloadImage(candidate.url);
    if (downloaded) break;
  }

  if (!downloaded) return { status: 'failed', reason: 'no fetchable icon found' };

  await saveAsset(FAVICONS_ROOT, kind, slug, downloaded.buf, downloaded.ext);
  return { status: 'saved', ext: downloaded.ext };
}

/** Fetches and caches just the cover image (og:image) for one entry - a standalone, fresh fetch. */
export async function fetchCoverForEntry(kind, slug, url, { force = false } = {}) {
  if (!force) {
    const existing = await cachedCoverExt(kind, slug);
    if (existing) return { status: 'skipped', ext: existing };
  }

  const head = await fetchHtmlHead(url);
  if (!head) return { status: 'failed', reason: 'page unreachable' };

  const { imageUrl } = extractMeta(head.html, head.finalUrl);
  if (!imageUrl) return { status: 'failed', reason: 'no og:image found' };

  return cacheCoverFromUrl(kind, slug, imageUrl, { force });
}

/**
 * The combined, single-fetch enrichment used at add-time: one HTTP request for the page's <head>
 * feeds the favicon, cover image, title, and description all at once, rather than fetching the
 * same page repeatedly for each. Title/description are returned whenever found on the page -
 * callers decide whether to use them (only when their own field is genuinely blank; never
 * overwrite something a person actually typed).
 *
 * @returns {Promise<{
 *   favicon: {status, ext?, reason?},
 *   cover: {status, ext?, reason?},
 *   title?: string,
 *   description?: string,
 *   imageUrl?: string,
 * }>}
 */
export async function enrichEntry(kind, slug, url, { force = false } = {}) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    const reason = 'entry URL is not a valid absolute URL';
    return { favicon: { status: 'failed', reason }, cover: { status: 'failed', reason } };
  }

  const head = await fetchHtmlHead(url);
  const meta = head ? extractMeta(head.html, head.finalUrl) : {};

  const iconCandidates = head ? extractIconCandidates(head.html, head.finalUrl) : [];
  iconCandidates.push({ url: `${origin}/favicon.ico`, score: -1 });

  let favicon;
  if (!force && (await cachedFaviconExt(kind, slug))) {
    favicon = { status: 'skipped', ext: await cachedFaviconExt(kind, slug) };
  } else {
    let downloaded = null;
    for (const candidate of iconCandidates.slice(0, 4)) {
      downloaded = await downloadImage(candidate.url);
      if (downloaded) break;
    }
    favicon = downloaded
      ? await saveAsset(FAVICONS_ROOT, kind, slug, downloaded.buf, downloaded.ext).then(() => ({
          status: 'saved',
          ext: downloaded.ext,
        }))
      : { status: 'failed', reason: 'no fetchable icon found' };
  }

  const cover = meta.imageUrl
    ? await cacheCoverFromUrl(kind, slug, meta.imageUrl, { force })
    : { status: 'failed', reason: 'no og:image found' };

  return { favicon, cover, title: meta.title, description: meta.description, imageUrl: meta.imageUrl };
}

/**
 * Pure network fetch, no disk I/O and no slug required - used when the entry's final slug isn't
 * known yet (its filename derives from the title, which may itself need to come from this same
 * fetch). Returns downloaded-but-not-yet-cached favicon/cover bytes alongside title/description,
 * so a caller can decide the slug first and then cache them with `cacheCandidate` below without
 * hitting the network a second time.
 */
export async function fetchPageDetails(url) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return { favicon: null, cover: null };
  }

  const head = await fetchHtmlHead(url);
  const meta = head ? extractMeta(head.html, head.finalUrl) : {};

  const iconCandidates = head ? extractIconCandidates(head.html, head.finalUrl) : [];
  iconCandidates.push({ url: `${origin}/favicon.ico`, score: -1 });

  let favicon = null;
  for (const candidate of iconCandidates.slice(0, 4)) {
    favicon = await downloadImage(candidate.url);
    if (favicon) break;
  }

  const cover = meta.imageUrl ? await downloadImage(meta.imageUrl) : null;

  return { title: meta.title, description: meta.description, imageUrl: meta.imageUrl, favicon, cover };
}

/** Caches a pre-fetched {buf, ext} candidate (from fetchPageDetails) under a now-known slug. */
export async function cacheCandidate(kind, slug, candidate, { root = 'favicon' } = {}) {
  const isFavicon = root === 'favicon';
  const rootDir = isFavicon ? FAVICONS_ROOT : COVERS_ROOT;
  const cachedExtFn = isFavicon ? cachedFaviconExt : cachedCoverExt;

  const existing = await cachedExtFn(kind, slug);
  if (existing) return { status: 'skipped', ext: existing };

  if (!candidate) {
    return { status: 'failed', reason: isFavicon ? 'no fetchable icon found' : 'no og:image found' };
  }

  await saveAsset(rootDir, kind, slug, candidate.buf, candidate.ext);
  return { status: 'saved', ext: candidate.ext };
}
