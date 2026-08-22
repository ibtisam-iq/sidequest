import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'js-yaml';
import { PATHS } from './yaml-io.mjs';
import { slugify, isValidSlug } from './slugify.mjs';
import { findNearMatches } from './levenshtein.mjs';

/**
 * The open category/country registry.
 *
 * Entry counts are deliberately NOT stored here — they are computed on demand. A stored count
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

export async function slugsFor(type) {
  return (await categoriesFor(type)).map((c) => c.slug);
}

/**
 * Check a proposed category/country before it gets created.
 *
 * Returns { slug, exists, nearMatches } — `nearMatches` is the "did you mean 'ai-tools'? you
 * typed 'ai-tool'" list that keeps the taxonomy from fragmenting into near-duplicates.
 * The caller decides what to do: the interactive CLIs prompt, the issue-to-PR workflow just
 * notes it in the PR body so a human reviewer can judge.
 */
export async function checkCategory(input, type) {
  const slug = slugify(input);
  if (!isValidSlug(slug)) {
    throw new Error(`"${input}" does not normalize to a valid slug`);
  }

  const existing = await slugsFor(type);
  return {
    slug,
    exists: existing.includes(slug),
    nearMatches: existing.includes(slug) ? [] : findNearMatches(slug, existing),
  };
}

/**
 * Append a category to the registry and create its data folder.
 * No-op if it already exists. Appends rather than rewriting so the file's comment header and
 * hand-written ordering survive.
 */
export async function addCategory({ slug, name, type }) {
  if (!isValidSlug(slug)) throw new Error(`Invalid slug: ${slug}`);
  if (type !== 'links' && type !== 'companies') {
    throw new Error(`Invalid taxonomy type: ${type}`);
  }

  const existing = await readTaxonomy();
  if (existing.some((c) => c.slug === slug && c.type === type)) return false;

  const block = `\n- slug: ${slug}\n  name: ${name}\n  type: ${type}\n`;
  const current = await readFile(PATHS.taxonomy, 'utf8');
  await writeFile(PATHS.taxonomy, `${current.trimEnd()}\n${block}`, 'utf8');

  await mkdir(path.join(PATHS[type], slug), { recursive: true });
  return true;
}

/** A reasonable display name for a slug, used as the default when registering a new category. */
export function displayNameFor(slug) {
  return slug
    .split('-')
    .map((word) => (word.length <= 2 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)))
    .join(' ');
}
