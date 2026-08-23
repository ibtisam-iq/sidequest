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
 *
 * There is no data/links/ wrapper folder - links sit directly at data/<root>[/<sub>/...]/*.yaml
 * for one of the six fixed roots. Companies are a feature of Career, not a sibling top-level
 * folder, so they live nested at data/career/companies/<country>/*.yaml. Both collections glob
 * the same data/ tree; the links loader excludes the companies subtree with a negated pattern
 * (Astro's glob loader passes `!`-prefixed patterns through as ignore rules), and the companies
 * loader is scoped to exactly that subtree.
 */

const dataRoot = new URL('../../data/', import.meta.url);
const companiesDir = new URL('../../data/career/companies/', import.meta.url);

/**
 * Entry ids are the bare filename, not the category-prefixed path, so `alternatives: [obsidian]`
 * stays human-writable. validate.mjs enforces the per-collection slug uniqueness that makes this
 * unambiguous.
 */
const bareFilename = ({ entry }: { entry: string }) =>
  entry.replace(/\.ya?ml$/, '').split('/').pop()!;

const links = defineCollection({
  loader: glob({
    pattern: ['**/*.yaml', '!career/companies/**'],
    base: dataRoot,
    generateId: bareFilename,
  }),
  schema: linkSchema,
});

const companies = defineCollection({
  loader: glob({
    pattern: '**/*.yaml',
    base: companiesDir,
    generateId: bareFilename,
  }),
  schema: companySchema,
});

const categories = defineCollection({
  loader: file(new URL('../../taxonomy/categories.yaml', import.meta.url).pathname, {
    // Supplying a parser means we receive the raw text and parse it ourselves. We need to,
    // because the loader requires every record to carry a unique `id` and the registry is
    // keyed by type + FULL PATH, not bare slug - the same slug can legitimately exist for both
    // entity types (a "remote" links category and a "remote" company country, say), and at
    // arbitrary link depth it can also recur across different branches (a "documentation"
    // subcategory under two unrelated parents).
    parser: (text: string) => {
      const parsed = load(text);
      if (!Array.isArray(parsed)) throw new Error('taxonomy/categories.yaml must be a list');
      return parsed.map((c: Record<string, unknown>) => ({
        id: `${c.type}:${c.parent ? `${c.parent}/` : ''}${c.slug}`,
        ...c,
      }));
    },
  }),
  schema: z.object({
    slug: z.string(),
    name: z.string(),
    type: z.enum(['links', 'companies']),
    // Omitted for a top-level category; otherwise the FULL PATH of the immediate parent - links
    // support arbitrary depth below a root, companies stay flat and never set this. See
    // scripts/lib/taxonomy.mjs for why full-path (not bare-slug) parents are what make depth
    // unbounded without ambiguity.
    parent: z.string().optional(),
  }),
});

export const collections = { links, companies, categories };
