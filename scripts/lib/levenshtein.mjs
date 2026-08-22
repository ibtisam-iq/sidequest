/**
 * Hand-rolled Levenshtein distance — deliberately dependency-free, because this runs in CI as
 * well as in the local CLIs and the scripts/ folder is kept install-light.
 *
 * Single-row DP, O(a*b) time and O(b) space.
 */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, j) => j);

  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] =
        a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = above;
    }
  }

  return row[b.length];
}

/**
 * Whether two slugs are close enough to be a likely typo of one another.
 *
 * Absolute distance alone is wrong at both ends: distance 2 is a huge difference between
 * three-letter slugs, and a tiny one between thirty-letter slugs. So accept either a small
 * absolute distance OR a small proportional one.
 */
export function isNearMatch(a, b) {
  if (a === b) return false;
  const distance = levenshtein(a, b);
  const ratio = distance / Math.max(a.length, b.length);
  return distance <= 2 || ratio < 0.3;
}

/** Existing slugs that look like typos of `candidate`, closest first. */
export function findNearMatches(candidate, existing) {
  return existing
    .filter((slug) => isNearMatch(candidate, slug))
    .map((slug) => ({ slug, distance: levenshtein(candidate, slug) }))
    .sort((x, y) => x.distance - y.distance)
    .map(({ slug }) => slug);
}
