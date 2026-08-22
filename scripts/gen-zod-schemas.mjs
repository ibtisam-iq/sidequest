#!/usr/bin/env node
/**
 * Generates the Astro content-collection zod schemas from schema/*.json.
 *
 * `schema/*.json` is the single source of truth: validate.mjs enforces it with ajv in CI and
 * locally, and this script projects the same rules into the zod schemas Astro needs for typed
 * content. Nothing here is hand-maintained, so the two cannot drift.
 *
 * Runs automatically via `predev` / `prebuild` in site/package.json.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import jsonSchemaToZod from 'json-schema-to-zod';
import { REPO_ROOT, PATHS } from './lib/yaml-io.mjs';

const OUT_DIR = path.join(REPO_ROOT, 'site', 'src', 'schemas', 'generated');

const TARGETS = [
  { file: 'link.schema.json', out: 'link.ts', name: 'linkSchema' },
  { file: 'company.schema.json', out: 'company.ts', name: 'companySchema' },
];

const HEADER = `// GENERATED FILE - DO NOT EDIT.
// Produced by scripts/gen-zod-schemas.mjs from schema/*.json, which is the single source of
// truth for both this and scripts/validate.mjs. Edit the JSON Schema instead and re-run
// \`npm run build\` (or \`npm run dev\`) in site/.
`;

await mkdir(OUT_DIR, { recursive: true });

for (const { file, out, name } of TARGETS) {
  const schema = JSON.parse(await readFile(path.join(PATHS.schema, file), 'utf8'));

  const generated = jsonSchemaToZod(schema, { module: 'esm', name });

  // Astro bundles its own zod (v4) and does not require the standalone package to be installed,
  // so point the generated import at astro/zod rather than a bare "zod" specifier.
  let body = generated.replace(/^import \{ z \} from "zod"/m, 'import { z } from "astro/zod"');

  if (body === generated) {
    throw new Error(
      `Expected a bare "zod" import in the generated ${out} to rewrite, but found none. ` +
        `json-schema-to-zod may have changed its output format.`,
    );
  }

  // json-schema-to-zod still emits the Zod 3 string-format style. Both forms work in Zod 4 but
  // the old ones are deprecated, so rewrite them to the current idioms - otherwise every build
  // reports deprecation hints, and the generated code breaks outright on the next Zod major.
  body = body
    .replaceAll('z.string().url()', 'z.url()')
    .replaceAll('z.string().date()', 'z.iso.date()');

  await writeFile(path.join(OUT_DIR, out), `${HEADER}\n${body}\n`, 'utf8');
  console.log(`  generated site/src/schemas/generated/${out}`);
}
