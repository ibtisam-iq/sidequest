import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { load } from 'js-yaml';
import { PATHS, folderFor } from './yaml-io.mjs';
import { slugify, isValidSlug } from './slugify.mjs';
import { findNearMatches } from './levenshtein.mjs';

/**
 * Exact category paths that require every entry filed there to disclose legal_risk: true, and
 * where nothing else may set it. Shadow-library-style content (things a visitor might not
 * realize carry copyright/legal exposure) is filed by content type under whichever of the six
 * roots actually fits it, rather than living under one shared "shadow-libraries" parent - so
 * this has to be an exact-path list, not a category prefix. scripts/validate.mjs enforces it,
 * scripts/add-link.mjs and scripts/lib/issue-form.mjs both read it so all three can't drift.
 */
export const LEGAL_RISK_REQUIRED_CATEGORIES = [
  'learning/books-academic-papers',
  'lifestyle/movies-torrents',
  'technology/cracked-software-apks',
];

/**
 * The open category registry - an arbitrary-depth tree under six fixed roots. Each record is
 * { slug, name, parent? }. No `parent` means top-level (one of the six roots). `parent` holds the
 * FULL PATH of the immediate parent category (e.g. `technology`, or `technology/dev-tools` for a
 * category nested one level deeper still) - not just its bare slug. Storing the full path rather
 * than a bare slug is what makes depth genuinely unbounded without ambiguity: two categories
 * under different branches are free to reuse the same slug (a "documentation" subcategory could
 * exist under both `technology/dev-tools/kubernetes` and `technology/dev-tools/docker`) because
 * each is identified by its distinct full parent path, not by slug alone.
 *
 * For a root-level category, or any two-level path (the common case so far), the parent value is
 * just the root slug - identical to before this supported deeper nesting.
 *
 * An entry's `category` field is a path: "root", "root/sub", or "root/sub/sub/...".
 *
 * Entry counts are deliberately NOT stored here - they are computed on demand. A stored count
 * would put every single-entry PR on the same line of this one file, guaranteeing merge
 * conflicts between concurrent issue-form contributions.
 */

export async function readTaxonomy() {
  const parsed = load(await readFile(PATHS.taxonomy, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error('taxonomy/categories.yaml must contain a top-level list');
  }
  return parsed;
}

/** Top-level categories only (no `parent`) - the six roots. */
export async function topLevel() {
  return (await readTaxonomy()).filter((c) => !c.parent);
}

/**
 * The registered direct children of one category, given its FULL PATH (null/omitted for
 * top-level). "Direct" - grandchildren are not included, since every consumer that needs the
 * whole subtree already walks it path by path via resolveCategoryPath instead.
 */
export async function childrenOf(parentPath = null) {
  return (await readTaxonomy()).filter((c) => (c.parent ?? null) === parentPath);
}

export async function allSlugs() {
  return (await readTaxonomy()).map((c) => c.slug);
}

/**
 * Parses and validates a category PATH ("root", "root/sub", "root/sub/sub", ...) against the
 * registry, to any depth. Returns { valid, chain, reason }. `chain` is the matched registry
 * record for every segment, root first - `chain.at(-1)` is the leaf category the path resolves
 * to. Never throws - a bad path is just `valid: false`.
 *
 * Each segment is matched by slug AND the exact accumulated path so far, not by slug alone - so
 * this stays correct even where two categories in different branches happen to share a slug.
 */
export async function resolveCategoryPath(categoryPath) {
  if (typeof categoryPath !== 'string' || !categoryPath) {
    return { valid: false, reason: 'category is empty' };
  }

  const segments = categoryPath.split('/');
  const all = await readTaxonomy();
  const chain = [];
  let parentPath = null;

  for (const slug of segments) {
    const match = all.find((c) => c.slug === slug && (c.parent ?? null) === parentPath);
    if (!match) {
      return {
        valid: false,
        reason: parentPath
          ? `"${slug}" is not a registered subcategory of "${parentPath}"`
          : `"${slug}" is not a registered top-level category`,
      };
    }
    chain.push(match);
    parentPath = parentPath ? `${parentPath}/${slug}` : slug;
  }

  return { valid: true, chain };
}

/**
 * Check a proposed category/subcategory before it gets created.
 *
 * The fuzzy check is scoped to SIBLINGS, not the whole registry: a new top-level category is
 * checked against the other top-level categories, and a new subcategory is checked only against
 * the other subcategories of the same parent. This is what stops "AI Chat Assistants" from
 * fuzzy-matching against "Business & Company Research" just because both happen to be
 * subcategories of something - they are never siblings, so they are never compared.
 *
 * `parentPath` is the FULL PATH of the immediate parent, null/undefined for a top-level check.
 * Returns { slug, exists, nearMatches } - the caller decides what to do: the interactive CLI
 * prompts, the issue-to-PR workflow just notes it in the PR body for a human reviewer.
 */
export async function checkCategory(input, parentPath = null) {
  const slug = slugify(input);
  if (!isValidSlug(slug)) {
    throw new Error(`"${input}" does not normalize to a valid slug`);
  }

  const siblings = parentPath ? await childrenOf(parentPath) : await topLevel();
  const siblingSlugs = siblings.map((c) => c.slug);

  return {
    slug,
    exists: siblingSlugs.includes(slug),
    nearMatches: siblingSlugs.includes(slug) ? [] : findNearMatches(slug, siblingSlugs),
  };
}

/**
 * Append a category/subcategory to the registry and create its data folder.
 * No-op if it already exists (checked within the same scope: siblings under `parent`, or
 * top-level when `parent` is omitted). Appends rather than rewriting so the file's comment
 * header and hand-written ordering survive.
 */
export async function addCategory({ slug, name, parent = null }) {
  if (!isValidSlug(slug)) throw new Error(`Invalid slug: ${slug}`);

  const existing = await readTaxonomy();
  const already = existing.some(
    (c) => c.slug === slug && (c.parent ?? null) === (parent ?? null),
  );
  if (already) return false;

  const block = parent
    ? `\n- slug: ${slug}\n  name: ${name}\n  parent: ${parent}\n`
    : `\n- slug: ${slug}\n  name: ${name}\n`;
  const current = await readFile(PATHS.taxonomy, 'utf8');
  await writeFile(PATHS.taxonomy, `${current.trimEnd()}\n${block}`, 'utf8');

  await mkdir(folderFor(parent ? `${parent}/${slug}` : slug), { recursive: true });
  return true;
}

/** A reasonable display name for a slug, used as the default when registering a new category. */
export function displayNameFor(slug) {
  return slug
    .split('-')
    .map((word) => (word.length <= 2 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)))
    .join(' ');
}
