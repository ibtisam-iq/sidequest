#!/usr/bin/env node
/** Interactive local CLI for adding a link entry. `npm run add-link` */

import { loadCollection } from './lib/yaml-io.mjs';
import { normalizeUrl } from './lib/url.mjs';
import { slugifyList } from './lib/slugify.mjs';
import {
  p,
  bail,
  todayIso,
  requiredText,
  promptUrl,
  promptTags,
  promptOptional,
  pickCategory,
  resolveEntryPath,
  writeAndValidate,
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

const title = bail(
  await p.text({ message: 'Title', placeholder: 'Ghostty', validate: requiredText('A title') }),
);

const category = await pickCategory('links');
const tags = await promptTags('Tags (comma-separated)');

// Content-integrity rule, not optional styling: validate.mjs rejects any shadow-libraries entry
// missing this, so the CLI asks up front rather than letting the write fail after the fact.
const requiresLegalRisk =
  category === 'shadow-libraries' || category.startsWith('shadow-libraries/');
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
    p.cancel('Every shadow-libraries entry must disclose legal_risk - nothing was written.');
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

const description = await promptOptional('One-line description', 'What is it, in a sentence?');
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

const { filePath } = resolveEntryPath('links', category, title);

// Key order here is the order they appear in the written YAML - required first, then optional.
const entry = {
  url,
  title: title.trim(),
  category,
  ...(description && { description }),
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

await writeAndValidate(filePath, entry);
