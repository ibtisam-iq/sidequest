import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'js-yaml';
import { PATHS } from './yaml-io.mjs';
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
 * The open category/country registry - a two-level tree for `links`, a flat list for
 * `companies`. Each record is { slug, name, type, parent? }. No `parent` means top-level; a
 * `parent` (a top-level slug of the same type) makes it a subcategory. Only two levels are
 * supported - a subcategory never itself has children.
 *
 * A link's `category` field is a path: "parent-slug" (flat) or "parent-slug/sub-slug". A
 * company's `country` field is always a bare top-level slug, unaffected by any of this -
 * `parent` is never set on a companies record.
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

export async function categoriesFor(type) {
  return (await readTaxonomy()).filter((c) => c.type === type);
}

/** Top-level categories only (no `parent`) - the parents in the tree. */
export async function topLevelFor(type) {
  return (await categoriesFor(type)).filter((c) => !c.parent);
}

/** The registered subcategories of one top-level category. */
export async function childrenOf(type, parentSlug) {
  return (await categoriesFor(type)).filter((c) => c.parent === parentSlug);
}

export async function slugsFor(type) {
  return (await categoriesFor(type)).map((c) => c.slug);
}

/**
 * Parses and validates a category PATH ("parent" or "parent/sub") against the registry.
 * Returns { valid, parent, sub, reason }. `parent` and `sub` are the matched registry records
 * (sub is null for a flat path). Never throws - a bad path is just `valid: false`.
 */
export async function resolveCategoryPath(type, categoryPath) {
  if (typeof categoryPath !== 'string' || !categoryPath) {
    return { valid: false, reason: 'category is empty' };
  }

  const [parentSlug, subSlug, ...rest] = categoryPath.split('/');
  if (rest.length) {
    return { valid: false, reason: 'only two levels are supported (parent or parent/sub)' };
  }

  const all = await categoriesFor(type);
  const parent = all.find((c) => c.slug === parentSlug && !c.parent);
  if (!parent) {
    return { valid: false, reason: `"${parentSlug}" is not a registered top-level category` };
  }

  if (!subSlug) return { valid: true, parent, sub: null };

  const sub = all.find((c) => c.slug === subSlug && c.parent === parentSlug);
  if (!sub) {
    return {
      valid: false,
      reason: `"${subSlug}" is not a registered subcategory of "${parentSlug}"`,
    };
  }

  return { valid: true, parent, sub };
}

/**
 * Check a proposed category/subcategory/country before it gets created.
 *
 * The fuzzy check is scoped to SIBLINGS, not the whole registry: a new top-level category is
 * checked against other top-level categories of the same type, and a new subcategory is checked
 * only against the other subcategories of the same parent. This is what stops "AI Chat
 * Assistants" from fuzzy-matching against "Business & Company Research" just because both
 * happen to be subcategories of something - they are never siblings, so they are never compared.
 *
 * `parentSlug` is null/undefined for a top-level check (or any companies check, which is always
 * flat). Returns { slug, exists, nearMatches } - the caller decides what to do: the interactive
 * CLIs prompt, the issue-to-PR workflow just notes it in the PR body for a human reviewer.
 */
export async function checkCategory(input, type, parentSlug = null) {
  const slug = slugify(input);
  if (!isValidSlug(slug)) {
    throw new Error(`"${input}" does not normalize to a valid slug`);
  }

  const siblings = parentSlug ? await childrenOf(type, parentSlug) : await topLevelFor(type);
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
 * top-level of `type` when `parent` is omitted). Appends rather than rewriting so the file's
 * comment header and hand-written ordering survive.
 */
export async function addCategory({ slug, name, type, parent = null }) {
  if (!isValidSlug(slug)) throw new Error(`Invalid slug: ${slug}`);
  if (type !== 'links' && type !== 'companies') {
    throw new Error(`Invalid taxonomy type: ${type}`);
  }
  if (parent && type !== 'links') {
    throw new Error('Only links categories may have a parent - companies stay flat');
  }

  const existing = await readTaxonomy();
  const already = existing.some(
    (c) => c.slug === slug && c.type === type && (c.parent ?? null) === (parent ?? null),
  );
  if (already) return false;

  const block = parent
    ? `\n- slug: ${slug}\n  name: ${name}\n  type: ${type}\n  parent: ${parent}\n`
    : `\n- slug: ${slug}\n  name: ${name}\n  type: ${type}\n`;
  const current = await readFile(PATHS.taxonomy, 'utf8');
  await writeFile(PATHS.taxonomy, `${current.trimEnd()}\n${block}`, 'utf8');

  const folder = parent ? path.join(PATHS[type], parent, slug) : path.join(PATHS[type], slug);
  await mkdir(folder, { recursive: true });
  return true;
}

/** A reasonable display name for a slug, used as the default when registering a new category. */
export function displayNameFor(slug) {
  return slug
    .split('-')
    .map((word) => (word.length <= 2 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)))
    .join(' ');
}
