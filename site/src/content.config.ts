import { defineCollection } from 'astro:content';
// `z` re-exported from astro:content is deprecated in Astro 7; astro/zod is the supported entry
// point, and it is the same instance the generated schemas import.
import { z } from 'astro/zod';
import { glob, file } from 'astro/loaders';
import { load } from 'js-yaml';
import { linkSchema } from './schemas/generated/link';
import { companySchema } from './schemas/generated/company';

/**
 * Content lives in the repo-root data/ and taxonomy/ directories, deliberately outside this
 * Astro project - the YAML files are the product, and the site is just one consumer of them.
 * Astro's glob loader accepts an absolute file URL as `base`, so no copying or symlinking is
 * needed. `.yaml` is a data entry type registered by Astro core, so it is parsed natively.
 */

const dataDir = (name: string) => new URL(`../../data/${name}/`, import.meta.url);

/**
 * Entry ids are the bare filename, not the category-prefixed path, so `alternatives: [obsidian]`
 * stays human-writable. validate.mjs enforces the per-collection slug uniqueness that makes this
 * unambiguous.
 */
const bareFilename = ({ entry }: { entry: string }) =>
  entry.replace(/\.ya?ml$/, '').split('/').pop()!;

const links = defineCollection({
  loader: glob({
    pattern: '**/*.yaml',
    base: dataDir('links'),
    generateId: bareFilename,
  }),
  schema: linkSchema,
});

const companies = defineCollection({
  loader: glob({
    pattern: '**/*.yaml',
    base: dataDir('companies'),
    generateId: bareFilename,
  }),
  schema: companySchema,
});

const categories = defineCollection({
  loader: file(new URL('../../taxonomy/categories.yaml', import.meta.url).pathname, {
    // Supplying a parser means we receive the raw text and parse it ourselves. We need to,
    // because the loader requires every record to carry a unique `id` and the registry is
    // keyed by slug *and* type - the same slug can legitimately exist for both entity types
    // (a "remote" links category and a "remote" company country, say).
    parser: (text: string) => {
      const parsed = load(text);
      if (!Array.isArray(parsed)) throw new Error('taxonomy/categories.yaml must be a list');
      return parsed.map((c: Record<string, unknown>) => ({ id: `${c.type}:${c.slug}`, ...c }));
    },
  }),
  schema: z.object({
    slug: z.string(),
    name: z.string(),
    type: z.enum(['links', 'companies']),
  }),
});

export const collections = { links, companies, categories };
