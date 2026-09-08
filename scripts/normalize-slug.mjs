#!/usr/bin/env node
/**
 * CLI wrapper over lib/slugify.mjs + lib/taxonomy.mjs.
 *
 *   node scripts/normalize-slug.mjs "AI Tool"                just normalize
 *   node scripts/normalize-slug.mjs "AI Tool" --check        normalize + registry fuzzy check
 *   node scripts/normalize-slug.mjs "Kubernetes" --check --parent technology/dev-tools
 *
 * The fuzzy check is scoped to siblings, so --parent decides what it is compared against:
 * omitted, it checks against the six roots; given a category path, against that category's
 * existing children.
 */
import { slugify } from './lib/slugify.mjs';
import { checkCategory } from './lib/taxonomy.mjs';

const args = process.argv.slice(2);
const input = args[0];
const wantsCheck = args.includes('--check');
const parentFlag = args.indexOf('--parent');
const parent = parentFlag === -1 ? null : args[parentFlag + 1];

if (!input) {
  console.error('usage: node scripts/normalize-slug.mjs <text> [--check] [--parent <category-path>]');
  process.exit(1);
}

if (!wantsCheck) {
  console.log(slugify(input));
  process.exit(0);
}

const scope = parent ? `subcategories of "${parent}"` : 'the top-level roots';

try {
  const { slug, exists, nearMatches } = await checkCategory(input, parent);
  console.log(slug);

  if (exists) {
    console.log(`  already registered among ${scope}`);
  } else if (nearMatches.length) {
    console.log(`  NEW - but did you mean: ${nearMatches.join(', ')}?`);
  } else {
    console.log(`  NEW - nothing similar among ${scope}`);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
