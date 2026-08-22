#!/usr/bin/env node
/** CLI wrapper over lib/url.mjs - prints the canonical form used for duplicate checks. */
import { normalizeUrl } from './lib/url.mjs';

const input = process.argv[2];

if (!input) {
  console.error('usage: node scripts/normalize-url.mjs <url>');
  process.exit(1);
}

try {
  console.log(normalizeUrl(input));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
