import { defineCollection } from 'astro:content';
// `z` re-exported from astro:content is deprecated in Astro 7; astro/zod is the supported entry
// point, and it is the same instance the generated schemas import.
import { z } from 'astro/zod';
import { glob, file } from 'astro/loaders';
import { load } from 'js-yaml';
import { linkSchema } from './schemas/generated/link';

/**
 * Content lives in the repo-root data/ and taxonomy/ directories, deliberately outside this
 * Astro project - the YAML files are the product, and the site is just one consumer of them.
 * Astro's glob loader accepts an absolute file URL as `base`, so no copying or symlinking is
 * needed. `.yaml` is a data entry type registered by Astro core, so it is parsed natively.
 *
 * There is no wrapper folder above the roots - entries sit directly at
 * data/<root>[/<sub>/...]/*.yaml for one of the six fixed roots.
 */

const dataRoot = new URL('../../data/', import.meta.url);

/**
 * Entry ids are the bare filename, not the category-prefixed path, so `alternatives: [obsidian]`
 * stays human-writable. validate.mjs enforces the per-collection slug uniqueness that makes this
 * unambiguous.
 */
const bareFilename = ({ entry }: { entry: string }) =>
  entry.replace(/\.ya?ml$/, '').split('/').pop()!;

const links = defineCollection({
  loader: glob({ pattern: '**/*.yaml', base: dataRoot, generateId: bareFilename }),
  schema: linkSchema,
});

const categories = defineCollection({
  loader: file(new URL('../../taxonomy/categories.yaml', import.meta.url).pathname, {
    // Supplying a parser means we receive the raw text and parse it ourselves. We need to,
    // because the loader requires every record to carry a unique `id` and the registry is keyed
    // by FULL PATH, not bare slug - at arbitrary depth the same slug can recur across different
    // branches (a "documentation" subcategory under two unrelated parents).
    parser: (text: string) => {
      const parsed = load(text);
      if (!Array.isArray(parsed)) throw new Error('taxonomy/categories.yaml must be a list');
      return parsed.map((c: Record<string, unknown>) => ({
        id: `${c.parent ? `${c.parent}/` : ''}${c.slug}`,
        ...c,
      }));
    },
  }),
  schema: z.object({
    slug: z.string(),
    name: z.string(),
    // Omitted for a top-level category; otherwise the FULL PATH of the immediate parent. See
    // scripts/lib/taxonomy.mjs for why full-path (not bare-slug) parents are what make depth
    // unbounded without ambiguity.
    parent: z.string().optional(),
  }),
});

export const collections = { links, categories };
