import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, dump } from 'js-yaml';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const PATHS = {
  links: path.join(REPO_ROOT, 'data', 'links'),
  companies: path.join(REPO_ROOT, 'data', 'companies'),
  taxonomy: path.join(REPO_ROOT, 'taxonomy', 'categories.yaml'),
  schema: path.join(REPO_ROOT, 'schema'),
};

export async function readYaml(filePath) {
  return load(await readFile(filePath, 'utf8'));
}

export async function writeYaml(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  // js-yaml picks the quote style itself (v5 emits single quotes and ignores `quotingType`).
  // That's fine: what matters is that it quotes date strings at all, so they round-trip as
  // strings rather than being re-read as timestamps.
  const body = dump(data, { lineWidth: 100, noRefs: true });
  await writeFile(filePath, body, 'utf8');
}

/** Every *.yaml under a directory, recursively. Returns [] when the directory doesn't exist. */
export async function listYamlFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.yaml')) continue;
    out.push(path.join(entry.parentPath ?? entry.path, entry.name));
  }
  return out.sort();
}

/**
 * Load every entry of one collection with the context validation needs: the parsed data, the
 * slug (bare filename), and the category path it sits under (which must agree with the entry's
 * own category/country field).
 *
 * `categoryPath` is every directory segment between the collection root and the file, joined
 * with "/" - "pakistan" for a companies entry, "github-repos" for a flat links category,
 * "ai-tools/ai-coding-agents" for a nested one. This is what makes the two-level links
 * hierarchy and the flat companies registry validate against the exact same logic.
 */
export async function loadCollection(kind) {
  const dir = PATHS[kind];
  const files = await listYamlFiles(dir);

  return Promise.all(
    files.map(async (file) => {
      const segments = path.relative(dir, path.dirname(file)).split(path.sep).filter(Boolean);
      return {
        file,
        relPath: path.relative(REPO_ROOT, file),
        slug: path.basename(file, '.yaml'),
        categoryPath: segments.join('/'),
        data: await readYaml(file),
      };
    }),
  );
}
