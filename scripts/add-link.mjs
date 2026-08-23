#!/usr/bin/env node
/** Interactive local CLI for adding a link entry. `npm run add-link` */

import { loadCollection } from './lib/yaml-io.mjs';
import { normalizeUrl } from './lib/url.mjs';
import { slugifyList } from './lib/slugify.mjs';
import { LEGAL_RISK_REQUIRED_CATEGORIES } from './lib/taxonomy.mjs';
import {
  p,
  bail,
  todayIso,
  promptUrl,
  promptTags,
  promptOptional,
  pickCategory,
  resolveEntryPath,
  writeAndValidate,
  fetchPageDetails,
} from './lib/cli-shared.mjs';

p.intro('sidequest - add a link');

const [links, companies] = await Promise.all([
  loadCollection('links'),
  loadCollection('companies'),
]);

// Duplicate URLs are checked across the whole dataset, companies included.
const existingUrls = new Map();
for (const e of links) {
  try {
    existingUrls.set(normalizeUrl(e.data.url), e.relPath);
  } catch {}
}
for (const e of companies) {
  try {
    existingUrls.set(normalizeUrl(e.data.website), e.relPath);
  } catch {}
}

const url = await promptUrl('URL', existingUrls);

// One request for the page's <head> feeds the favicon, cover image, title, and description all
// at once - fetched here, before the title is finalized, because the filename this entry gets
// written to depends on the title, and the title itself may come from this very fetch.
const s0 = p.spinner();
s0.start('Fetching page details');
const details = await fetchPageDetails(url);
s0.stop(details.title ? `Found "${details.title}"` : 'Could not read the page - title required');

const title = bail(
  await p.text({
    message: details.title
      ? 'Title (leave blank to use the page title above)'
      : 'Title',
    placeholder: details.title || 'Ghostty',
  }),
);
const finalTitle = (title ?? '').trim() || details.title;
if (!finalTitle) {
  p.cancel('No title given, and none could be found on the page - re-run and type one by hand.');
  process.exit(1);
}

const category = await pickCategory('links');
const tags = await promptTags('Tags (comma-separated)');

// Content-integrity rule, not optional styling: validate.mjs rejects any entry filed under one
// of these categories that's missing this, so the CLI asks up front rather than letting the
// write fail after the fact.
const requiresLegalRisk = LEGAL_RISK_REQUIRED_CATEGORIES.includes(category);
let legalRisk;
if (requiresLegalRisk) {
  legalRisk = bail(
    await p.confirm({
      message:
        'This category may involve copyright infringement depending on jurisdiction. Confirm the warning badge should show?',
      initialValue: true,
    }),
  );
  if (!legalRisk) {
    p.cancel('This category requires disclosing legal_risk - nothing was written.');
    process.exit(1);
  }
}

const priority = bail(
  await p.select({
    message: 'Priority',
    initialValue: 'medium',
    options: [
      { value: 'high', label: 'High', hint: 'genuinely reach for this' },
      { value: 'medium', label: 'Medium' },
      { value: 'low', label: 'Low', hint: 'worth remembering, not urgent' },
    ],
  }),
);

const description = await promptOptional(
  details.description ? 'One-line description (leave blank to use the page description)' : 'One-line description',
  details.description || 'What is it, in a sentence?',
);
const finalDescription = description || details.description;
const note = await promptOptional('Note', 'Why you saved it / where you found it');

const audience = slugifyList(
  bail(
    await p.multiselect({
      message: 'Audience (optional - space to select, enter to confirm)',
      required: false,
      options: [
        { value: 'developers', label: 'Developers' },
        { value: 'non-technical', label: 'Non-technical' },
        { value: 'job-seekers', label: 'Job seekers' },
        { value: 'students', label: 'Students' },
        { value: 'everyone', label: 'Everyone' },
      ],
    }),
  ) ?? [],
);

const linkSlugs = links.map((e) => e.slug).sort();
let alternatives = [];

if (linkSlugs.length) {
  const wantsAlternatives = bail(
    await p.confirm({ message: 'Link this to similar/alternative tools?', initialValue: false }),
  );

  if (wantsAlternatives) {
    alternatives = bail(
      await p.multiselect({
        message: 'Alternatives (shown on both entries - the reverse link is automatic)',
        required: false,
        options: linkSlugs.map((slug) => ({ value: slug, label: slug })),
      }),
    );
  }
}

const addedBy = await promptOptional('Your GitHub username', 'ibtisam-iq');

const { filePath } = resolveEntryPath('links', category, finalTitle);

// Key order here is the order they appear in the written YAML - required first, then optional.
const entry = {
  url,
  title: finalTitle.trim(),
  category,
  ...(finalDescription && { description: finalDescription }),
  ...(details.imageUrl && { image: details.imageUrl }),
  tags,
  priority,
  ...(audience.length && { audience }),
  ...(alternatives.length && { alternatives }),
  ...(requiresLegalRisk && { legal_risk: true }),
  date_added: todayIso(),
  source: 'local',
  ...(addedBy && { added_by: addedBy }),
  ...(note && { note }),
};

await writeAndValidate('links', filePath, entry, {
  precached: { favicon: details.favicon, cover: details.cover },
});
