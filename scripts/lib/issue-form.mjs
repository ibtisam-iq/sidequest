import { slugify, slugifyList, isValidSlug } from './slugify.mjs';
import { normalizeUrl } from './url.mjs';

/**
 * Parsing for GitHub Issue Form submissions.
 *
 * GitHub renders an issue form into the issue body as markdown — `### <label>` followed by the
 * value — not as structured JSON, so it has to be parsed. Doing it here (rather than with a
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

const COMPANY_FIELDS = {
  'company name': 'name',
  website: 'website',
  country: 'country',
  industry: 'industry',
  'careers url': 'careers_url',
  'hiring status': 'hiring_status',
  size: 'size',
  'remote policy': 'remote_policy',
  'why is it notable?': 'rating',
  tags: 'tags',
};

const PRIORITIES = new Set(['high', 'medium', 'low']);
const HIRING = new Set(['actively-hiring', 'unknown', 'not-hiring']);
const SIZES = new Set(['startup', 'mid', 'enterprise']);
const REMOTE = new Set(['remote', 'hybrid', 'onsite', 'unknown']);

const splitList = (value) => slugifyList((value ?? '').split(/[,\n]/));

/** Dropdown values arrive as their human label, e.g. "Actively hiring". */
const pickEnum = (value, allowed, fallback) => {
  const slug = slugify(value ?? '');
  return allowed.has(slug) ? slug : fallback;
};

function buildLink(fields, { author, today }) {
  const errors = [];
  const get = (key) => (fields.get(key) ?? '').trim();

  const rawUrl = get('url');
  let url = '';
  try {
    url = normalizeUrl(rawUrl);
  } catch {
    errors.push(`"${rawUrl || '(empty)'}" is not a valid URL.`);
  }

  const title = get('title');
  if (!title) errors.push('Title is required.');

  const category = slugify(get('category'));
  if (!isValidSlug(category)) errors.push('Category is required.');

  const tags = splitList(get('tags'));
  if (!tags.length) errors.push('At least one tag is required.');

  const description = get('description');
  const note = get('note');
  const audience = splitList(get('audience'));
  const alternatives = splitList(get('alternatives'));

  const entry = {
    url,
    title,
    category,
    ...(description && { description }),
    tags,
    priority: pickEnum(get('priority'), PRIORITIES, 'medium'),
    ...(audience.length && { audience }),
    ...(alternatives.length && { alternatives }),
    date_added: today,
    source: 'issue-form',
    ...(author && { added_by: author }),
    ...(note && { note }),
  };

  return { kind: 'links', entry, group: category, slug: slugify(title), errors };
}

function buildCompany(fields, { today }) {
  const errors = [];
  const get = (key) => (fields.get(key) ?? '').trim();

  const rawSite = get('website');
  let website = '';
  try {
    website = normalizeUrl(rawSite);
  } catch {
    errors.push(`"${rawSite || '(empty)'}" is not a valid website URL.`);
  }

  const name = get('name');
  if (!name) errors.push('Company name is required.');

  const country = slugify(get('country'));
  if (!isValidSlug(country)) errors.push('Country is required.');

  const industry = slugify(get('industry'));
  if (!isValidSlug(industry)) errors.push('Industry is required.');

  let careersUrl = '';
  const rawCareers = get('careers_url');
  if (rawCareers) {
    try {
      careersUrl = normalizeUrl(rawCareers);
    } catch {
      errors.push(`"${rawCareers}" is not a valid careers URL.`);
    }
  }

  const size = pickEnum(get('size'), SIZES, '');
  const rating = get('rating');
  const tags = splitList(get('tags'));

  const entry = {
    name,
    website,
    country,
    industry,
    ...(size && { size }),
    remote_policy: pickEnum(get('remote_policy'), REMOTE, 'unknown'),
    hiring_status: pickEnum(get('hiring_status'), HIRING, 'unknown'),
    ...(careersUrl && { careers_url: careersUrl }),
    ...(tags.length && { tags }),
    ...(rating && { rating }),
    date_added: today,
    source: 'issue-form',
  };

  return { kind: 'companies', entry, group: country, slug: slugify(name), errors };
}

/**
 * @param kind   'links' | 'companies'
 * @param body   raw issue body markdown
 * @param today  ISO date string, injected so the result is deterministic in tests
 */
export function parseSubmission(kind, body, { author = '', today } = {}) {
  if (kind !== 'links' && kind !== 'companies') {
    throw new Error(`Unknown submission kind: ${kind}`);
  }

  const labels = parseIssueBody(body);
  const map = kind === 'links' ? LINK_FIELDS : COMPANY_FIELDS;

  // Re-key from the human-readable form labels onto schema field names.
  const fields = new Map();
  for (const [label, value] of labels) {
    const field = map[label];
    if (field) fields.set(field, value);
  }

  const result =
    kind === 'links'
      ? buildLink(fields, { author, today })
      : buildCompany(fields, { author, today });

  if (!result.slug) result.errors.push('Could not derive a filename from the title/name.');

  return result;
}
