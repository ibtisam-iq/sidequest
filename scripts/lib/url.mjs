/**
 * Canonical URL form used for every duplicate check in the repo — the local CLIs, validate.mjs,
 * and the issue-to-PR workflow all compare against this, so "https://Example.com/x/?utm_source=a"
 * and "http://example.com/x" are correctly recognised as the same entry.
 */

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'fbclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'source',
  'igshid',
  'si',
  'spm',
  '_hsenc',
  '_hsmi',
  'yclid',
  'vero_id',
]);

export function normalizeUrl(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new TypeError('normalizeUrl expects a non-empty string');
  }

  const withProtocol = /^https?:\/\//i.test(input.trim())
    ? input.trim()
    : `https://${input.trim()}`;

  let url;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new TypeError(`Not a valid URL: ${input}`);
  }

  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';

  if (
    (url.port === '80' && url.protocol === 'http:') ||
    (url.port === '443' && url.protocol === 'https:')
  ) {
    url.port = '';
  }

  for (const param of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(param.toLowerCase())) url.searchParams.delete(param);
  }
  url.searchParams.sort();

  // Trailing slash is not meaningful for the pages we catalogue, but keep it for a bare origin
  // so the result stays a valid-looking URL.
  let pathname = url.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
  url.pathname = pathname;

  return url.toString();
}

/** True when two URLs point at the same thing once normalized. */
export function sameUrl(a, b) {
  try {
    return normalizeUrl(a) === normalizeUrl(b);
  } catch {
    return false;
  }
}
