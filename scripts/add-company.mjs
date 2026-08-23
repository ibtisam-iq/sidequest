#!/usr/bin/env node
/** Interactive local CLI for adding a company entry. `npm run add-company` */

import { loadCollection } from './lib/yaml-io.mjs';
import { normalizeUrl } from './lib/url.mjs';
import { slugify } from './lib/slugify.mjs';
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

p.intro('sidequest - add a company');

const [links, companies] = await Promise.all([
  loadCollection('links'),
  loadCollection('companies'),
]);

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

const website = await promptUrl('Website', existingUrls);

const name = bail(
  await p.text({
    message: 'Company name',
    placeholder: 'Arbisoft',
    validate: requiredText('A name'),
  }),
);

const country = await pickCategory('companies');

// Industry is deliberately free-form and NOT registered in the taxonomy - companies vary too
// widely for a curated list to be worth maintaining.
const industry = slugify(
  bail(
    await p.text({
      message: 'Industry',
      placeholder: 'fintech, saas, consulting, software-development',
      validate(value) {
        if (!slugify(value ?? '')) return 'An industry is required';
      },
    }),
  ),
);

const size = bail(
  await p.select({
    message: 'Size (optional)',
    initialValue: '__skip__',
    options: [
      { value: 'startup', label: 'Startup' },
      { value: 'mid', label: 'Mid-size' },
      { value: 'enterprise', label: 'Enterprise' },
      { value: '__skip__', label: 'Skip' },
    ],
  }),
);

const remotePolicy = bail(
  await p.select({
    message: 'Remote policy',
    initialValue: 'unknown',
    options: [
      { value: 'remote', label: 'Remote' },
      { value: 'hybrid', label: 'Hybrid' },
      { value: 'onsite', label: 'Onsite' },
      { value: 'unknown', label: 'Unknown' },
    ],
  }),
);

const hiringStatus = bail(
  await p.select({
    message: 'Hiring status',
    initialValue: 'unknown',
    options: [
      { value: 'actively-hiring', label: 'Actively hiring' },
      { value: 'not-hiring', label: 'Not hiring' },
      { value: 'unknown', label: 'Unknown' },
    ],
  }),
);

const careersUrl = await promptOptional('Careers URL', 'https://example.com/careers');
const rating = await promptOptional('Why is this company notable?', 'Your personal take');
const tags = await promptTags('Tags (comma-separated, optional)', { required: false });

const { filePath } = resolveEntryPath('companies', country, name);

const entry = {
  name: name.trim(),
  website,
  country,
  industry,
  ...(size !== '__skip__' && { size }),
  remote_policy: remotePolicy,
  hiring_status: hiringStatus,
  ...(careersUrl && { careers_url: careersUrl }),
  ...(tags.length && { tags }),
  ...(rating && { rating }),
  date_added: todayIso(),
  source: 'local',
};

await writeAndValidate('companies', filePath, entry);
