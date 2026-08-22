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
 * Links are a two-level tree (top-level category, optionally a subcategory); companies stay a
 * flat list of countries, entirely unaffected by any of this.
 */

let cache: Promise<Data> | null = null;

export interface CategoryNode {
  slug: string;
  name: string;
  /** This category's own direct entries, plus (for a top-level node) every child's too. */
  count: number;
  children: CategoryNode[];
}

interface Data {
  links: LinkEntry[];
  companies: CompanyEntry[];
  categories: CategoryEntry[];
  linkCategories: CategoryEntry[];
  countries: CategoryEntry[];
  /** Full category path ("parent" or "parent/sub") -> its entries. */
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

/**
 * Splits a category path ("parent" or "parent/sub") into its display names, looked up against
 * the registry so a renamed category never shows a stale label.
 */
export async function describeCategoryPath(categoryPath: string) {
  const data = await getData();
  const [parentSlug, subSlug] = categoryPath.split('/');
  const parent = data.linkCategories.find((c) => c.data.slug === parentSlug && !c.data.parent);
  const sub = subSlug
    ? data.linkCategories.find((c) => c.data.slug === subSlug && c.data.parent === parentSlug)
    : undefined;

  return {
    parentSlug,
    parentName: parent?.data.name ?? parentSlug,
    subSlug: sub?.data.slug,
    subName: sub?.data.name,
  };
}

/**
 * The full links category tree with computed counts - never stored, always derived from the
 * current dataset. A top-level node's count includes every entry filed under any of its
 * children, so the mega-menu and homepage can show one meaningful number per parent.
 */
export async function getLinkCategoryTree(): Promise<CategoryNode[]> {
  const data = await getData();
  const countFor = (path: string) => data.linksByCategoryPath.get(path)?.length ?? 0;

  const topLevel = data.linkCategories.filter((c) => !c.data.parent);

  return topLevel
    .map((parent) => {
      const children = data.linkCategories
        .filter((c) => c.data.parent === parent.data.slug)
        .map((child) => ({
          slug: child.data.slug,
          name: child.data.name,
          count: countFor(`${parent.data.slug}/${child.data.slug}`),
          children: [] as CategoryNode[],
        }));

      const ownCount = countFor(parent.data.slug);
      const childCount = children.reduce((sum, c) => sum + c.count, 0);

      return {
        slug: parent.data.slug,
        name: parent.data.name,
        count: ownCount + childCount,
        children: children.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
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
  /** Full category path for a link ("parent" or "parent/sub"); bare country slug for a company. */
  group: string;
  groupName: string;
  parentSlug: string;
  parentName: string;
  subSlug?: string;
  subName?: string;
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
      const { parentSlug, parentName, subSlug, subName } = await describeCategoryPath(
        l.data.category,
      );
      return {
        type: 'link',
        slug: l.id,
        title: l.data.title,
        // Entry URLs no longer nest under a category: link slugs are already unique dataset-
        // wide (validate.mjs enforces it), and a flat /links/entry/<slug> URL never breaks when
        // an entry is re-categorized, unlike one that encodes the category path.
        href: `/links/entry/${l.id}`,
        url: l.data.url,
        description: l.data.description,
        group: l.data.category,
        groupName: subName ?? parentName,
        parentSlug,
        parentName,
        subSlug,
        subName,
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
    href: `/companies/${c.data.country}/entry/${c.id}`,
    url: c.data.website,
    description: c.data.rating,
    group: c.data.country,
    groupName: countryName(c.data.country),
    parentSlug: c.data.country,
    parentName: countryName(c.data.country),
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
