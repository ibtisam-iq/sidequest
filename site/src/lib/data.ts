import { getCollection, type CollectionEntry } from 'astro:content';

export type LinkEntry = CollectionEntry<'links'>;
export type CompanyEntry = CollectionEntry<'companies'>;
export type CategoryEntry = CollectionEntry<'categories'>;

/**
 * Build-time data layer.
 *
 * Everything here is memoized at module scope. A static `astro build` runs in a single Node
 * process, so each collection is read and each derived structure computed exactly once no matter
 * how many pages ask for it - that is what keeps build time flat as the dataset grows into the
 * thousands, rather than every category page re-scanning the whole set.
 *
 * Links are an arbitrary-depth tree below one of six fixed roots; companies stay a flat list of
 * countries, entirely unaffected by any of this.
 */

let cache: Promise<Data> | null = null;

export interface CategoryNode {
  /** Full path from the root, e.g. "technology" or "technology/dev-tools/kubernetes". */
  path: string;
  slug: string;
  name: string;
  /** This category's own direct entries, plus every descendant's too. */
  count: number;
  /** True if this category has any registered subcategories - drives "show children as a grid". */
  hasChildren: boolean;
  children: CategoryNode[];
}

/** One segment of a resolved category path, root first. */
export interface CategoryCrumb {
  slug: string;
  name: string;
  /** Full path up to and including this segment. */
  path: string;
}

interface Data {
  links: LinkEntry[];
  companies: CompanyEntry[];
  categories: CategoryEntry[];
  linkCategories: CategoryEntry[];
  countries: CategoryEntry[];
  /** Full category path (any depth) -> its DIRECT entries only, not descendants'. */
  linksByCategoryPath: Map<string, LinkEntry[]>;
  companiesByCountry: Map<string, CompanyEntry[]>;
  /** slug -> related link slugs, forward refs unioned with reverse refs. */
  alternatives: Map<string, string[]>;
  linkBySlug: Map<string, LinkEntry>;
  tagCounts: Map<string, number>;
}

const byDateDesc = <T extends { data: { date_added: string } }>(a: T, b: T) =>
  b.data.date_added.localeCompare(a.data.date_added);

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}

/**
 * The alternatives relationship is declared one-way in YAML but presented both ways: if A lists
 * B as an alternative, B's page shows A too. Computed once over the whole dataset here rather
 * than per entry page.
 */
function buildAlternatives(links: LinkEntry[]): Map<string, string[]> {
  const known = new Set(links.map((l) => l.id));
  const related = new Map<string, Set<string>>(links.map((l) => [l.id, new Set<string>()]));

  for (const link of links) {
    for (const alt of link.data.alternatives ?? []) {
      // validate.mjs fails the build on a dangling reference, so this only guards the dev
      // server against a half-typed slug.
      if (!known.has(alt) || alt === link.id) continue;
      related.get(link.id)!.add(alt);
      related.get(alt)!.add(link.id);
    }
  }

  return new Map([...related].map(([slug, set]) => [slug, [...set].sort()]));
}

async function build(): Promise<Data> {
  const [links, companies, categories] = await Promise.all([
    getCollection('links'),
    getCollection('companies'),
    getCollection('categories'),
  ]);

  links.sort(byDateDesc);
  companies.sort(byDateDesc);

  const tagCounts = new Map<string, number>();
  for (const link of links) {
    for (const tag of link.data.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  return {
    links,
    companies,
    categories,
    linkCategories: categories.filter((c) => c.data.type === 'links'),
    countries: categories.filter((c) => c.data.type === 'companies' && !c.data.parent),
    linksByCategoryPath: groupBy(links, (l) => l.data.category),
    companiesByCountry: groupBy(companies, (c) => c.data.country),
    alternatives: buildAlternatives(links),
    linkBySlug: new Map(links.map((l) => [l.id, l])),
    tagCounts,
  };
}

export function getData(): Promise<Data> {
  cache ??= build();
  return cache;
}

/** Every entry directly under `path`, plus every entry under any descendant of it. */
function countUnder(data: Data, categoryPath: string): number {
  let n = data.linksByCategoryPath.get(categoryPath)?.length ?? 0;
  const prefix = `${categoryPath}/`;
  for (const [key, entries] of data.linksByCategoryPath) {
    if (key.startsWith(prefix)) n += entries.length;
  }
  return n;
}

/**
 * Resolves a category PATH ("root", "root/sub", "root/sub/sub", ...) into its full breadcrumb
 * chain, root first, looked up against the registry so a renamed category never shows a stale
 * label. Depth is unbounded - this is what lets a leaf entry page or a deeply nested category
 * page render a breadcrumb of any length.
 */
export async function describeCategoryPath(categoryPath: string): Promise<CategoryCrumb[]> {
  const data = await getData();
  const segments = categoryPath.split('/');
  const chain: CategoryCrumb[] = [];
  let parentPath: string | undefined;

  for (const slug of segments) {
    const match = data.linkCategories.find(
      (c) => c.data.slug === slug && (parentPath ? c.data.parent === parentPath : !c.data.parent),
    );
    parentPath = parentPath ? `${parentPath}/${slug}` : slug;
    chain.push({ slug, name: match?.data.name ?? slug, path: parentPath });
  }

  return chain;
}

/** The registered direct children of one category (or the six roots, for `parentPath` null), with computed counts. */
export async function getCategoryChildren(parentPath: string | null): Promise<CategoryNode[]> {
  const data = await getData();

  const directChildren = data.linkCategories.filter((c) =>
    parentPath ? c.data.parent === parentPath : !c.data.parent,
  );

  return directChildren
    .map((child) => {
      const path = parentPath ? `${parentPath}/${child.data.slug}` : child.data.slug;
      const hasChildren = data.linkCategories.some((c) => c.data.parent === path);
      return {
        path,
        slug: child.data.slug,
        name: child.data.name,
        count: countUnder(data, path),
        hasChildren,
        children: [] as CategoryNode[],
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * The top-level links tree, two levels deep (root, and each root's immediate children) with
 * computed counts - never stored, always derived from the current dataset. This is exactly what
 * the mega-menu needs: it only ever shows a root's immediate children on hover/tap, regardless of
 * how much deeper the real tree goes underneath - deeper levels are reached by clicking into a
 * category page and browsing further, not by cascading flyouts.
 */
export async function getLinkCategoryTree(): Promise<CategoryNode[]> {
  const roots = await getCategoryChildren(null);

  const withChildren = await Promise.all(
    roots.map(async (root) => ({ ...root, children: await getCategoryChildren(root.path) })),
  );

  // The six roots are fixed, durable life-domain categories, not a ranked list - they always
  // show alphabetically, never reordered by count. (Their children still rank by count above -
  // that tier is genuinely open-ended, so surfacing the fullest ones first helps.)
  return withChildren.sort((a, b) => a.name.localeCompare(b.name));
}

/** Companies stay flat - unchanged shape, just filtered to top-level (always true for them). */
export async function getCategoriesWithCounts() {
  const data = await getData();
  return data.countries
    .map((c) => ({
      slug: c.data.slug,
      name: c.data.name,
      count: data.companiesByCountry.get(c.data.slug)?.length ?? 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const NEW_WINDOW_DAYS = 14;

/** True for entries added within the last two weeks - drives the "New" badge. */
export function isNew(dateAdded: string, now = new Date()): boolean {
  const added = new Date(`${dateAdded}T00:00:00Z`);
  if (Number.isNaN(added.getTime())) return false;
  const days = (now.getTime() - added.getTime()) / 86_400_000;
  return days >= 0 && days <= NEW_WINDOW_DAYS;
}

/** Shape shared by the client-side filtering JSON and the card component. */
export interface CardItem {
  type: 'link' | 'company';
  slug: string;
  title: string;
  href: string;
  url: string;
  description?: string;
  /** Full category path (any depth) for a link; bare country slug for a company. */
  group: string;
  /** The leaf category/country display name. */
  groupName: string;
  /** Full breadcrumb chain root-first, links only - undefined for a company. */
  categoryChain?: CategoryCrumb[];
  tags: string[];
  priority?: string;
  audience?: string[];
  industry?: string;
  hiring_status?: string;
  remote_policy?: string;
  size?: string;
  legalRisk: boolean;
  date_added: string;
  isNew: boolean;
}

export async function getCardItems(): Promise<CardItem[]> {
  const data = await getData();

  const links: CardItem[] = await Promise.all(
    data.links.map(async (l): Promise<CardItem> => {
      const categoryChain = await describeCategoryPath(l.data.category);
      return {
        type: 'link',
        slug: l.id,
        title: l.data.title,
        // Entry URLs no longer nest under a category: link slugs are already unique dataset-
        // wide (validate.mjs enforces it), and a flat /entry/<slug> URL never breaks when an
        // entry is re-categorized, unlike one that encodes the category path.
        href: `/entry/${l.id}`,
        url: l.data.url,
        description: l.data.description,
        group: l.data.category,
        groupName: categoryChain.at(-1)!.name,
        categoryChain,
        tags: l.data.tags,
        priority: l.data.priority,
        audience: l.data.audience,
        legalRisk: l.data.legal_risk === true,
        date_added: l.data.date_added,
        isNew: isNew(l.data.date_added),
      };
    }),
  );

  const countryName = (slug: string) =>
    data.countries.find((c) => c.data.slug === slug)?.data.name ?? slug;

  const companies: CardItem[] = data.companies.map((c) => ({
    type: 'company',
    slug: c.id,
    title: c.data.name,
    href: `/career/companies/${c.data.country}/entry/${c.id}`,
    url: c.data.website,
    description: c.data.rating,
    group: c.data.country,
    groupName: countryName(c.data.country),
    tags: c.data.tags ?? [],
    industry: c.data.industry,
    hiring_status: c.data.hiring_status,
    remote_policy: c.data.remote_policy,
    size: c.data.size,
    legalRisk: false,
    date_added: c.data.date_added,
    isNew: isNew(c.data.date_added),
  }));

  return [...links, ...companies].sort((a, b) => b.date_added.localeCompare(a.date_added));
}
