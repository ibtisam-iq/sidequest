/**
 * Slug/tag normalization. Everything that becomes a category, country, tag, audience label, or
 * filename goes through here.
 *
 * Security-relevant: filenames written by the issue-to-PR workflow are always derived from
 * slugify() output, never from raw user text, so a crafted issue title cannot traverse paths.
 * The output character set is strictly [a-z0-9-].
 */

export function slugify(input) {
  if (typeof input !== 'string') return '';

  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents
    .replace(/['’]/g, '') // don't turn "don't" into "don-t"
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/** Slug for a set of tags/audience labels: normalized, de-duplicated, empties dropped. */
export function slugifyList(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  for (const value of values) {
    const slug = slugify(value);
    if (slug) seen.add(slug);
  }
  return [...seen];
}

export function isValidSlug(value) {
  return typeof value === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
}

/**
 * Slugifies a category PATH ("parent" or "parent/sub") segment by segment, preserving the "/" -
 * plain slugify() would flatten "ai-tools/ai-coding-agents" into one wrong slug, since a "/" is
 * just another non-[a-z0-9] character to it. Returns '' if either segment is empty after
 * normalizing, or if there are more than two segments (only two levels are supported).
 */
export function slugifyCategoryPath(input) {
  if (typeof input !== 'string') return '';

  const segments = input
    .split('/')
    .map((s) => slugify(s))
    .filter((s) => s !== '');

  if (segments.length === 0 || segments.length > 2) return '';
  if (segments.length !== input.split('/').length) return ''; // an empty segment was dropped

  return segments.join('/');
}
