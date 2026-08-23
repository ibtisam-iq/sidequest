/** Shared interactive pieces for add-link.mjs and add-company.mjs. */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import { REPO_ROOT, writeYaml, folderFor } from './yaml-io.mjs';
import {
  topLevelFor,
  childrenOf,
  checkCategory,
  addCategory,
  displayNameFor,
} from './taxonomy.mjs';
import { slugify, slugifyList } from './slugify.mjs';
import { normalizeUrl } from './url.mjs';
import { fetchFaviconForEntry } from './favicon.mjs';

/** Abort cleanly on Ctrl-C instead of writing a half-built entry. */
export function bail(value) {
  if (p.isCancel(value)) {
    p.cancel('Cancelled - nothing was written.');
    process.exit(0);
  }
  return value;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export const requiredText = (label) => (value) => {
  if (!value || !value.trim()) return `${label} is required`;
};

export async function promptUrl(message, existingUrls) {
  const raw = bail(
    await p.text({
      message,
      placeholder: 'https://example.com',
      validate(value) {
        if (!value || !value.trim()) return 'A URL is required';
        try {
          normalizeUrl(value);
        } catch {
          return 'That does not look like a valid URL';
        }
      },
    }),
  );

  const canonical = normalizeUrl(raw);
  const duplicate = existingUrls.get(canonical);

  if (duplicate) {
    p.log.error(`Already catalogued as ${duplicate}`);
    p.cancel('Duplicate URL - nothing was written.');
    process.exit(1);
  }

  if (canonical !== raw) p.log.info(`Normalized to ${canonical}`);
  return canonical;
}

export async function promptTags(message, { required = true } = {}) {
  const raw = bail(
    await p.text({
      message,
      placeholder: 'terminal, cli, productivity',
      validate(value) {
        if (!required) return;
        if (!slugifyList((value ?? '').split(',')).length) return 'At least one tag is required';
      },
    }),
  );
  return slugifyList((raw ?? '').split(','));
}

/** Optional free text - empty input means "omit the field entirely". */
export async function promptOptional(message, placeholder) {
  const value = bail(await p.text({ message: `${message} (optional)`, placeholder }));
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Prompts for a brand-new category/subcategory/country name, fuzzy-checks it against
 * `siblings`, and registers it. The fuzzy check is the whole point: it fires before anything is
 * written, scoped to `siblings` (already the right scope by the time this is called - top-level
 * categories of one type, or the subcategories of one specific parent), so the taxonomy doesn't
 * quietly fragment into ai-tool / ai-tools / ai_tools, and a subcategory never gets compared
 * against an unrelated parent's subcategories.
 */
async function createNewCategory({ label, type, parent, placeholder }) {
  const input = bail(
    await p.text({
      message: `New ${label} name`,
      placeholder,
      validate(value) {
        if (!slugify(value ?? '')) return 'That does not normalize to a usable slug';
      },
    }),
  );

  const { slug, exists, nearMatches } = await checkCategory(input, type, parent);

  if (exists) {
    p.log.info(`"${slug}" already exists - using it.`);
    return slug;
  }

  if (nearMatches.length) {
    p.log.warn(`You typed "${slug}", but these already exist: ${nearMatches.join(', ')}`);

    const resolution = bail(
      await p.select({
        message: 'Did you mean one of those?',
        options: [
          ...nearMatches.map((m) => ({ value: m, label: `Use "${m}"`, hint: 'recommended' })),
          { value: '__keep__', label: `No - "${slug}" is genuinely different` },
        ],
      }),
    );

    if (resolution !== '__keep__') return resolution;
  }

  const name = bail(
    await p.text({
      message: `Display name for "${slug}"`,
      initialValue: displayNameFor(slug),
      validate: requiredText('A display name'),
    }),
  );

  await addCategory({ slug, name: name.trim(), type, parent });
  p.log.success(`Registered new ${label} "${slug}" in taxonomy/categories.yaml`);
  return slug;
}

/**
 * Offers the existing `siblings` plus "+ Create a new <label>", and either returns the picked
 * slug or delegates to createNewCategory.
 */
async function pickOrCreate({ label, type, parent, siblings, placeholder }) {
  const choice = bail(
    await p.select({
      message: `Which ${label}?`,
      options: [
        ...siblings.map((c) => ({ value: c.slug, label: c.name, hint: c.slug })),
        { value: '__new__', label: `+ Create a new ${label}` },
      ],
    }),
  );

  if (choice !== '__new__') return choice;
  return createNewCategory({ label, type, parent, placeholder });
}

/**
 * Pick a country (companies stay flat, exactly as before), or a category PATH for a link -
 * top-level first, then optionally one of its subcategories. Returns the country slug, or the
 * full category path ("parent-slug" for a flat pick, "parent-slug/sub-slug" for a nested one).
 */
export async function pickCategory(type) {
  if (type === 'companies') {
    return pickOrCreate({
      label: 'country',
      type: 'companies',
      parent: null,
      siblings: await topLevelFor('companies'),
      placeholder: 'United States',
    });
  }

  const parentSlug = await pickOrCreate({
    label: 'category',
    type: 'links',
    parent: null,
    siblings: await topLevelFor('links'),
    placeholder: 'Podcasts',
  });

  const subSiblings = await childrenOf('links', parentSlug);

  const subChoice = bail(
    await p.select({
      message: `Subcategory under "${parentSlug}"?`,
      initialValue: subSiblings.length ? undefined : '__none__',
      options: [
        { value: '__none__', label: 'None - keep it flat under this category' },
        ...subSiblings.map((c) => ({ value: c.slug, label: c.name, hint: c.slug })),
        { value: '__new__', label: '+ Create a new subcategory' },
      ],
    }),
  );

  if (subChoice === '__none__') return parentSlug;
  if (subChoice !== '__new__') return `${parentSlug}/${subChoice}`;

  const subSlug = await createNewCategory({
    label: 'subcategory',
    type: 'links',
    parent: parentSlug,
    placeholder: 'e.g. CLI & Terminal',
  });
  return `${parentSlug}/${subSlug}`;
}

/** Unique filename within the collection folder, derived only from the normalized slug. */
export function resolveEntryPath(type, categoryPath, title) {
  const base = slugify(title);
  if (!base) throw new Error(`"${title}" does not normalize to a usable filename`);

  const dir = folderFor(type, categoryPath);
  let slug = base;
  let n = 2;
  while (existsSync(path.join(dir, `${slug}.yaml`))) slug = `${base}-${n++}`;

  return { slug, filePath: path.join(dir, `${slug}.yaml`) };
}

/**
 * Write the entry, fetch its favicon, then re-run the real validator over the whole dataset.
 *
 * Fetching here (rather than duplicating the call in add-link.mjs and add-company.mjs
 * separately) means both CLIs get it automatically, and a locally-added entry is committed with
 * its favicon already cached rather than waiting for the next deploy to pick it up.
 *
 * `kind` ('links' | 'companies') is passed explicitly by the caller - it can no longer be read
 * back out of the file path since links live directly under data/<root>/... with no wrapper
 * folder, and favicons are namespaced by kind regardless of where the entry sits on disk.
 */
export async function writeAndValidate(kind, filePath, data) {
  await writeYaml(filePath, data);

  const rel = path.relative(REPO_ROOT, filePath);
  p.log.success(`Wrote ${rel}`);

  const slug = path.basename(filePath, '.yaml');
  const url = data.url ?? data.website;

  if (url) {
    const s1 = p.spinner();
    s1.start('Fetching favicon');
    const favicon = await fetchFaviconForEntry(kind, slug, url);
    if (favicon.status === 'saved') s1.stop(`Cached favicon (.${favicon.ext})`);
    else if (favicon.status === 'skipped') s1.stop('Favicon already cached');
    else s1.stop(`No favicon found - will show a letter initial (${favicon.reason})`);
  }

  const s = p.spinner();
  s.start('Validating dataset');
  const result = spawnSync('node', [path.join(REPO_ROOT, 'scripts', 'validate.mjs')], {
    encoding: 'utf8',
  });

  if (result.status === 0) {
    s.stop('Validation passed');
    p.outro(`Done - commit ${rel} when you're ready.`);
    return;
  }

  s.stop('Validation failed');
  p.log.error((result.stdout + result.stderr).trim());
  p.outro(`${rel} was written but does not validate - fix it before committing.`);
  process.exitCode = 1;
}

export { p };
