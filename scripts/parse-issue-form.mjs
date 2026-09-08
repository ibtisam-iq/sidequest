#!/usr/bin/env node
/**
 * Turns a GitHub Issue Form submission into a data file, for .github/workflows/issue-to-pr.yml.
 *
 * Reads the untrusted issue body from the ISSUE_BODY environment variable - never from argv or
 * an interpolated shell string, which would be a script-injection hole in an issue-triggered
 * workflow.
 *
 * Usage:  ISSUE_BODY=... ISSUE_AUTHOR=... node scripts/parse-issue-form.mjs
 *
 * Writes the YAML file and emits key=value lines to $GITHUB_OUTPUT. Exit codes:
 *   0  file written
 *   1  the submission is invalid (reasons in the `errors` output)
 *   2  the URL is already in the directory (existing file in the `duplicate` output)
 */

import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { parseSubmission } from './lib/issue-form.mjs';
import { loadEntries, writeYaml, REPO_ROOT, folderFor } from './lib/yaml-io.mjs';
import { normalizeUrl } from './lib/url.mjs';
import { checkCategory, addCategory, displayNameFor } from './lib/taxonomy.mjs';
import { slugify } from './lib/slugify.mjs';
import { fetchPageDetails } from './lib/enrich.mjs';

const dryRun = process.argv.includes('--dry-run');

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

const { entry, group, slug: parsedSlug, errors } = parseSubmission(process.env.ISSUE_BODY ?? '', {
  author: (process.env.ISSUE_AUTHOR ?? '').trim(),
  today,
});

// Title and description are optional inputs - the same page fetch that would otherwise be
// deferred to deploy-time favicon/cover caching runs here instead, once, whenever either is left
// blank, and fills them in (and `image`) before validation. Never runs when the URL itself failed
// to parse, and never overwrites a field the submitter actually typed.
let slug = parsedSlug;
if (entry.url && (!entry.title || !entry.description)) {
  const details = await fetchPageDetails(entry.url);
  if (!entry.title && details.title) entry.title = details.title;
  if (!entry.description && details.description) entry.description = details.description;
  if (!entry.image && details.imageUrl) entry.image = details.imageUrl;
  slug = slugify(entry.title || '');
}

if (!entry.title) {
  errors.push(
    'Title is required, and none could be automatically determined from the page - please provide one.',
  );
}
if (!slug) errors.push('Could not derive a filename from the title/name.');

if (errors.length) await fail(errors.map((e) => `- ${e}`).join('\n'));

// Duplicate check across the entire dataset - the same rule validate.mjs enforces.
for (const existing of await loadEntries()) {
  const existingUrl = existing.data?.url;
  if (typeof existingUrl !== 'string') continue;
  try {
    if (normalizeUrl(existingUrl) !== entry.url) continue;
  } catch {
    continue;
  }
  setOutput('ok', 'false');
  setOutput('duplicate', existing.relPath);
  await flushOutputs();
  process.exit(2);
}

// A near-match on the category is a note for the reviewer, never a hard failure - a human is
// better placed than the automation to decide whether "ai-agents" is really "ai-tools".
// `group` is "parent" or "parent/sub" - each level is checked in its own scope (a subcategory is
// only fuzzy-matched against its siblings under the same parent).
const [parentSlug, subSlug] = group.split('/');

const parentCheck = await checkCategory(parentSlug);
const subCheck = subSlug ? await checkCategory(subSlug, parentSlug) : null;
const exists = parentCheck.exists && (!subCheck || subCheck.exists);

const newLevelNotes = [];
if (!parentCheck.exists) {
  newLevelNotes.push(
    parentCheck.nearMatches.length > 0
      ? `> [!WARNING]\n> This introduces a new top-level category \`${parentSlug}\`, but these ` +
        `already exist: ${parentCheck.nearMatches.map((m) => `\`${m}\``).join(', ')}.\n> ` +
        `Please confirm it is genuinely distinct before merging, or retarget the entry.`
      : `> [!NOTE]\n> This registers a new top-level category: \`${parentSlug}\`.`,
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
const relPath = path.relative(REPO_ROOT, path.join(folderFor(group), `${slug}.yaml`));

if (!dryRun) {
  if (!parentCheck.exists) {
    await addCategory({ slug: parentSlug, name: displayNameFor(parentSlug) });
  }
  if (subCheck && !subCheck.exists) {
    await addCategory({ slug: subSlug, name: displayNameFor(subSlug), parent: parentSlug });
  }
  await writeYaml(path.join(REPO_ROOT, relPath), entry);
}

setOutput('ok', 'true');
setOutput('path', relPath);
setOutput('slug', slug);
setOutput('group', group);
setOutput('title', entry.title);
setOutput('new_category', String(!exists));
setOutput('notes', notes);

await flushOutputs();
