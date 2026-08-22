import { writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT } from './yaml-io.mjs';

/**
 * Build-time favicon fetch-and-cache.
 *
 * Pages must never call out to a third-party favicon service at runtime - every entry's icon is
 * fetched once here, saved into site/public/favicons/<kind>/<slug>.<ext>, committed to git like
 * any other data file, and served from the same origin as the rest of the site from then on.
 * Favicon.astro falls back to a letter initial when no cached file exists for a slug; there is no
 * live fallback URL anywhere in the rendered page.
 *
 * Namespaced by kind (links/companies) because slugs are only unique WITHIN a collection - a link
 * and a company may legitimately share a slug, and they almost certainly have different icons.
 */

const FAVICONS_ROOT = path.join(REPO_ROOT, 'site', 'public', 'favicons');

const USER_AGENT = 'sidequest-favicon-fetcher/1.0 (+https://github.com/ibtisam-iq/sidequest)';
const FETCH_TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 300 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Every extension this module might have written, in no particular order. */
export const KNOWN_EXTENSIONS = ['svg', 'png', 'ico', 'jpg', 'gif', 'webp'];

function faviconDir(kind) {
  return path.join(FAVICONS_ROOT, kind);
}

/** The cached file's extension for a slug, or null if nothing is cached yet. */
export async function cachedFaviconExt(kind, slug) {
  let entries;
  try {
    entries = await readdir(faviconDir(kind));
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
 * Fetches just enough of the page to find <link rel="icon"> tags, capped at MAX_HTML_BYTES so a
 * huge page doesn't get downloaded in full just to read its <head>.
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

/** Downloads one candidate. Returns null on any failure - a bad candidate just gets skipped. */
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

  await mkdir(faviconDir(kind), { recursive: true });
  await writeFile(path.join(faviconDir(kind), `${slug}.${downloaded.ext}`), downloaded.buf);

  return { status: 'saved', ext: downloaded.ext };
}
