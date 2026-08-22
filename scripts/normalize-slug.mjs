#!/usr/bin/env node
/**
 * CLI wrapper over lib/slugify.mjs + lib/taxonomy.mjs.
 *
 *   node scripts/normalize-slug.mjs "AI Tool"                 just normalize
 *   node scripts/normalize-slug.mjs "AI Tool" --type links    normalize + registry fuzzy check
 */
import { slugify } from './lib/slugify.mjs';
import { checkCategory } from './lib/taxonomy.mjs';

const args = process.argv.slice(2);
const input = args[0];
const typeFlag = args.indexOf('--type');
const type = typeFlag === -1 ? null : args[typeFlag + 1];

if (!input) {
  console.error('usage: node scripts/normalize-slug.mjs <text> [--type links|companies]');
  process.exit(1);
}

if (!type) {
  console.log(slugify(input));
  process.exit(0);
}

if (type !== 'links' && type !== 'companies') {
  console.error(`--type must be "links" or "companies", got "${type}"`);
  process.exit(1);
}

try {
  const { slug, exists, nearMatches } = await checkCategory(input, type);
  console.log(slug);

  if (exists) {
    console.log(`  already registered under type: ${type}`);
  } else if (nearMatches.length) {
    console.log(`  NEW - but did you mean: ${nearMatches.join(', ')}?`);
  } else {
    console.log(`  NEW - no similar category exists under type: ${type}`);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
