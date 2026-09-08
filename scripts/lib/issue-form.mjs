import { slugify, slugifyList, slugifyCategoryPath } from './slugify.mjs';
import { normalizeUrl } from './url.mjs';
import { LEGAL_RISK_REQUIRED_CATEGORIES } from './taxonomy.mjs';

/**
 * Parsing for GitHub Issue Form submissions.
 *
 * GitHub renders an issue form into the issue body as markdown - `### <label>` followed by the
 * value - not as structured JSON, so it has to be parsed. Doing it here (rather than with a
 * marketplace action) keeps it in code we can unit-test and reuse the same normalization the
 * local CLIs use.
 *
 * SECURITY: the issue body is untrusted input from anyone on the internet.
 *  - Callers must pass it via an environment variable, never interpolate it into a shell command.
 *  - Slugs and filenames are always derived from slugify(), whose output is strictly [a-z0-9-],
 *    so a crafted title cannot escape the data directory.
 */

/** GitHub writes this into any optional field the submitter left blank. */
const NO_RESPONSE = '_no response_';

/** Splits `### Heading\n\nvalue` blocks into a label -> value map. */
export function parseIssueBody(body) {
  const fields = new Map();
  if (typeof body !== 'string') return fields;

  // Normalize newlines first: GitHub delivers CRLF, which otherwise ends up inside every value.
  const sections = body.replace(/\r\n/g, '\n').split(/^###[ \t]+/m).slice(1);

  for (const section of sections) {
    const newline = section.indexOf('\n');
    const label = (newline === -1 ? section : section.slice(0, newline)).trim().toLowerCase();
    const value = newline === -1 ? '' : section.slice(newline + 1).trim();
    if (!label) continue;
    fields.set(label, value.toLowerCase() === NO_RESPONSE ? '' : value);
  }

  return fields;
}

const LINK_FIELDS = {
  url: 'url',
  title: 'title',
  category: 'category',
  tags: 'tags',
  priority: 'priority',
  description: 'description',
  note: 'note',
  audience: 'audience',
  alternatives: 'alternatives',
};

const PRIORITIES = new Set(['high', 'medium', 'low']);

const splitList = (value) => slugifyList((value ?? '').split(/[,\n]/));

/** Dropdown values arrive as their human label, e.g. "High". */
const pickEnum = (value, allowed, fallback) => {
  const slug = slugify(value ?? '');
  return allowed.has(slug) ? slug : fallback;
};

function buildEntry(fields, { author, today }) {
  const errors = [];
  const get = (key) => (fields.get(key) ?? '').trim();

  const rawUrl = get('url');
  let url = '';
  try {
    url = normalizeUrl(rawUrl);
  } catch {
    errors.push(`"${rawUrl || '(empty)'}" is not a valid URL.`);
  }

  // Title is optional to type here - if left blank, parse-issue-form.mjs fetches the page and
  // fills it in from og:title/<title> before validation. It is still required in the final
  // committed YAML; that requirement just isn't enforced at this synchronous parsing stage,
  // since filling it in needs a network fetch this function deliberately doesn't make.
  const title = get('title');

  // "parent" or "parent/sub" - each segment slugified on its own so a submitted subcategory
  // path doesn't get flattened into one wrong slug (slugify() alone would treat "/" as just
  // another character to strip).
  const category = slugifyCategoryPath(get('category'));
  if (!category) errors.push('Category is required (use "parent" or "parent/sub").');

  const tags = splitList(get('tags'));
  if (!tags.length) errors.push('At least one tag is required.');

  const description = get('description');
  const note = get('note');
  const audience = splitList(get('audience'));
  const alternatives = splitList(get('alternatives'));

  // Content-integrity rule, not optional styling: validate.mjs rejects any entry filed under
  // one of these categories that's missing this, so it's set automatically from the category
  // rather than trusting a submitter to tick an extra box correctly.
  const legalRisk = LEGAL_RISK_REQUIRED_CATEGORIES.includes(category);

  const entry = {
    url,
    title,
    category,
    ...(description && { description }),
    tags,
    priority: pickEnum(get('priority'), PRIORITIES, 'medium'),
    ...(audience.length && { audience }),
    ...(alternatives.length && { alternatives }),
    ...(legalRisk && { legal_risk: true }),
    date_added: today,
    source: 'issue-form',
    ...(author && { added_by: author }),
    ...(note && { note }),
  };

  return { entry, group: category, slug: slugify(title), errors };
}


/**
 * @param body   raw issue body markdown
 * @param today  ISO date string, injected so the result is deterministic in tests
 *
 * An empty `slug` in the result is not an error here: it usually just means a genuinely blank
 * Title waiting on parse-issue-form.mjs's page-fetch enrichment step, so that check happens
 * there instead, after enrichment has had a chance to fill the title in.
 */
export function parseSubmission(body, { author = '', today } = {}) {
  const labels = parseIssueBody(body);

  // Re-key from the human-readable form labels onto schema field names.
  const fields = new Map();
  for (const [label, value] of labels) {
    const field = LINK_FIELDS[label];
    if (field) fields.set(field, value);
  }

  return buildEntry(fields, { author, today });
}
