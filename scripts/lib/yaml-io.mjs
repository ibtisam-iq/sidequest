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
  const body = dump(data, { lineWidth: 100, noRefs: true, quotingType: '"' });
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
 * slug (bare filename), and the folder it sits in (which must agree with the entry's own
 * category/country field).
 */
export async function loadCollection(kind) {
  const dir = PATHS[kind];
  const files = await listYamlFiles(dir);

  return Promise.all(
    files.map(async (file) => ({
      file,
      relPath: path.relative(REPO_ROOT, file),
      slug: path.basename(file, '.yaml'),
      folder: path.basename(path.dirname(file)),
      data: await readYaml(file),
    })),
  );
}
