#!/usr/bin/env node
/**
 * Turns a GitHub Issue Form submission into a data file, for .github/workflows/issue-to-pr.yml.
 *
 * Reads the untrusted issue body from the ISSUE_BODY environment variable - never from argv or
 * an interpolated shell string, which would be a script-injection hole in an issue-triggered
 * workflow.
 *
 * Usage:  ISSUE_BODY=... ISSUE_AUTHOR=... node scripts/parse-issue-form.mjs --kind links
 *
 * Writes the YAML file and emits key=value lines to $GITHUB_OUTPUT. Exit codes:
 *   0  file written
 *   1  the submission is invalid (reasons in the `errors` output)
 *   2  the URL is already in the directory (existing file in the `duplicate` output)
 */

import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { parseSubmission } from './lib/issue-form.mjs';
import { loadCollection, writeYaml, REPO_ROOT, folderFor } from './lib/yaml-io.mjs';
import { normalizeUrl } from './lib/url.mjs';
import { checkCategory, addCategory, displayNameFor } from './lib/taxonomy.mjs';
import { slugify } from './lib/slugify.mjs';
import { fetchPageDetails } from './lib/enrich.mjs';

const args = process.argv.slice(2);
const kindFlag = args.indexOf('--kind');
const kind = kindFlag === -1 ? '' : args[kindFlag + 1];
const dryRun = args.includes('--dry-run');

if (kind !== 'links' && kind !== 'companies') {
  console.error('usage: node scripts/parse-issue-form.mjs --kind <links|companies> [--dry-run]');
  process.exit(1);
}

const outputs = [];
const setOutput = (key, value) => outputs.push([key, String(value)]);

async function flushOutputs() {
  for (const [key, value] of outputs) console.log(`${key}=${value}`);
  if (!process.env.GITHUB_OUTPUT) return;
  // Multi-line-safe heredoc form, since notes and errors can contain newlines.
  const body = outputs
    .map(([key, value]) => `${key}<<__SQ_EOF__\n${value}\n__SQ_EOF__`)
    .join('\n');
  await appendFile(process.env.GITHUB_OUTPUT, `${body}\n`);
}

const fail = async (reason, code = 1) => {
  setOutput('ok', 'false');
  setOutput('errors', reason);
  await flushOutputs();
  process.exit(code);
};

const today = (process.env.TODAY || new Date().toISOString().slice(0, 10)).slice(0, 10);

const { entry, group, slug: parsedSlug, errors } = parseSubmission(kind, process.env.ISSUE_BODY ?? '', {
  author: (process.env.ISSUE_AUTHOR ?? '').trim(),
  today,
});

// Title and description are optional inputs for links - the same page fetch that would
// otherwise be deferred to deploy-time favicon/cover caching runs here instead, once, whenever
// either is left blank, and fills them in (and `image`) before validation. Never runs when the
// URL itself failed to parse, and never overwrites a field the submitter actually typed.
let slug = parsedSlug;
if (kind === 'links' && entry.url && (!entry.title || !entry.description)) {
  const details = await fetchPageDetails(entry.url);
  if (!entry.title && details.title) entry.title = details.title;
  if (!entry.description && details.description) entry.description = details.description;
  if (!entry.image && details.imageUrl) entry.image = details.imageUrl;
  slug = slugify(entry.title || '');
}

if (kind === 'links' && !entry.title) {
  errors.push(
    'Title is required, and none could be automatically determined from the page - please provide one.',
  );
}
if (!slug) errors.push('Could not derive a filename from the title/name.');

if (errors.length) await fail(errors.map((e) => `- ${e}`).join('\n'));

// Duplicate check across the entire dataset, links and companies together - the same rule
// validate.mjs enforces.
const [links, companies] = await Promise.all([
  loadCollection('links'),
  loadCollection('companies'),
]);

const candidate = kind === 'links' ? entry.url : entry.website;

for (const existing of [...links, ...companies]) {
  const existingUrl = existing.data?.url ?? existing.data?.website;
  if (typeof existingUrl !== 'string') continue;
  try {
    if (normalizeUrl(existingUrl) !== candidate) continue;
  } catch {
    continue;
  }
  setOutput('ok', 'false');
  setOutput('duplicate', existing.relPath);
  await flushOutputs();
  process.exit(2);
}

// A near-match on the category is a note for the reviewer, never a hard failure - a human is
// better placed than the automation to decide whether "ai-agents" is really "ai-tools". For
// links, `group` is "parent" or "parent/sub" - each level is checked in its own scope (a
// subcategory is only fuzzy-matched against its siblings under the same parent).
const label = kind === 'links' ? 'category' : 'country';
const [parentSlug, subSlug] = kind === 'links' ? group.split('/') : [group, undefined];

const parentCheck = await checkCategory(parentSlug, kind);
const subCheck = subSlug ? await checkCategory(subSlug, kind, parentSlug) : null;
const exists = parentCheck.exists && (!subCheck || subCheck.exists);

const newLevelNotes = [];
if (!parentCheck.exists) {
  newLevelNotes.push(
    parentCheck.nearMatches.length > 0
      ? `> [!WARNING]\n> This introduces a new top-level ${label} \`${parentSlug}\`, but these ` +
        `already exist: ${parentCheck.nearMatches.map((m) => `\`${m}\``).join(', ')}.\n> ` +
        `Please confirm it is genuinely distinct before merging, or retarget the entry.`
      : `> [!NOTE]\n> This registers a new top-level ${label}: \`${parentSlug}\`.`,
  );
}
if (subCheck && !subCheck.exists) {
  newLevelNotes.push(
    subCheck.nearMatches.length > 0
      ? `> [!WARNING]\n> This introduces a new subcategory \`${subSlug}\` of \`${parentSlug}\`, ` +
        `but these already exist under it: ` +
        `${subCheck.nearMatches.map((m) => `\`${m}\``).join(', ')}.\n> ` +
        `Please confirm it is genuinely distinct before merging, or retarget the entry.`
      : `> [!NOTE]\n> This registers a new subcategory: \`${parentSlug}/${subSlug}\`.`,
  );
}
const notes = newLevelNotes.join('\n');

// Filename comes only from the normalized slug, so a crafted title cannot traverse paths.
const relPath = path.relative(REPO_ROOT, path.join(folderFor(kind, group), `${slug}.yaml`));

if (!dryRun) {
  if (!parentCheck.exists) {
    await addCategory({ slug: parentSlug, name: displayNameFor(parentSlug), type: kind });
  }
  if (subCheck && !subCheck.exists) {
    await addCategory({
      slug: subSlug,
      name: displayNameFor(subSlug),
      type: kind,
      parent: parentSlug,
    });
  }
  await writeYaml(path.join(REPO_ROOT, relPath), entry);
}

setOutput('ok', 'true');
setOutput('path', relPath);
setOutput('slug', slug);
setOutput('group', group);
setOutput('title', kind === 'links' ? entry.title : entry.name);
setOutput('new_category', String(!exists));
setOutput('notes', notes);

await flushOutputs();
