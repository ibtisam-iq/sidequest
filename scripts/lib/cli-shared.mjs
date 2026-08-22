/** Shared interactive pieces for add-link.mjs and add-company.mjs. */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import { REPO_ROOT, writeYaml } from './yaml-io.mjs';
import { categoriesFor, checkCategory, addCategory, displayNameFor } from './taxonomy.mjs';
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
 * Pick an existing category/country, or register a new one.
 *
 * The fuzzy check is the whole point: it fires before anything is written, so the taxonomy
 * doesn't quietly fragment into ai-tool / ai-tools / ai_tools.
 */
export async function pickCategory(type) {
  const label = type === 'links' ? 'category' : 'country';
  const existing = await categoriesFor(type);

  const choice = bail(
    await p.select({
      message: `Which ${label}?`,
      options: [
        ...existing.map((c) => ({ value: c.slug, label: c.name, hint: c.slug })),
        { value: '__new__', label: `+ Create a new ${label}` },
      ],
    }),
  );

  if (choice !== '__new__') return choice;

  const input = bail(
    await p.text({
      message: `New ${label} name`,
      placeholder: type === 'links' ? 'Podcasts' : 'United States',
      validate(value) {
        if (!slugify(value ?? '')) return 'That does not normalize to a usable slug';
      },
    }),
  );

  const { slug, exists, nearMatches } = await checkCategory(input, type);

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

  await addCategory({ slug, name: name.trim(), type });
  p.log.success(`Registered new ${label} "${slug}" in taxonomy/categories.yaml`);
  return slug;
}

/** Unique filename within the collection folder, derived only from the normalized slug. */
export function resolveEntryPath(type, category, title) {
  const base = slugify(title);
  if (!base) throw new Error(`"${title}" does not normalize to a usable filename`);

  const dir = path.join(REPO_ROOT, 'data', type, category);
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
 */
export async function writeAndValidate(filePath, data) {
  await writeYaml(filePath, data);

  const rel = path.relative(REPO_ROOT, filePath);
  p.log.success(`Wrote ${rel}`);

  // data/<kind>/<category>/<slug>.yaml - kind and slug are read back out of the path itself
  // rather than threaded through as extra parameters everywhere writeAndValidate is called.
  const parts = rel.split(path.sep);
  const kind = parts[1];
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
