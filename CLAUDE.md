# CLAUDE.md - working context for sidequest

Read this file first. It is the complete working context for this repo; you should not need
anything re-explained by the user to start being useful.

Companion file: **`STATUS.md`** is the running build log - what has actually been done so far,
appended after every meaningful chunk of work. Read it second to learn the current state.
**`docs/PLAN.md`** is the approved build plan.

---

## The founding principle

sidequest is **not** a comprehensive directory of the best or most important tools in any
category. It is a personal log of things worth rescuing from being forgotten - specifically
things found incidentally while doing something else, that are useful but **not already famous
or well-known**.

Concretely: never add LinkedIn, YouTube, Google, or anything a typical person in the relevant
field would already know about. The value of this site is capturing the obscure and easily
forgotten, not being exhaustive. This is the actual reason the site is named "sidequest," and it
governs every categorization and inclusion decision below - including your own judgment calls
during a bulk import or when reviewing a submission.

**Applies going forward, not retroactively.** This principle was written down explicitly during
the six-root taxonomy restructuring (see STATUS.md). A handful of already-imported entries
(ChatGPT, Perplexity, Gemini, Grok, DeepSeek, Binance, PayPal, Stripe, Coursera, Udemy) were
explicitly requested by name in an earlier task before this rule existed, and were deliberately
kept as pre-principle legacy entries rather than removed - a settled decision, not an oversight.
Don't re-flag them or propose removing them; do apply the rule to everything new.

## What this project is

**sidequest** is an open-source, git-backed personal directory for saving anything interesting
found while browsing: tools, GitHub repos, articles, books, courses, communities, remote job
boards, referral links - plus a **companies** feature (tech companies worth knowing about,
organized by country, starting with Pakistan and expanding to US/Canada/remote), nested under the
Career section of the site rather than sitting as its own top-level entity type in the nav.

Inspiration is Awesome Lists and free-for.dev, but the comparison stops at mechanics - those
projects aim for comprehensiveness within a niche; sidequest deliberately does not, per the
founding principle above. What sidequest borrows is the two things a markdown list can't do:

1. **Scale** - hundreds of categories and thousands of entries, without a slow build or an
   unusable UI.
2. **A premium look** - a polished directory product, not a README rendered as HTML.

Live at **https://sidequest.ibtisam-iq.com** (GitHub Pages, custom domain).

### Core design constraints

- **Data is flat YAML files in git. There is no database.** Every feature must work within that.
- **Static output only.** No server at runtime - it is GitHub Pages.
- **Two contribution paths, both first-class:**
  1. The owner edits/adds YAML locally on their Mac and pushes directly.
  2. Anyone (owner included, e.g. from a phone) submits a GitHub Issue Form, which auto-opens a PR.

### Explicitly out of scope - do not add

Bookmark counts, upvote counts, "verified" badges, and any user-facing engagement, account, or
chat feature. Each requires user accounts and a backend, which contradicts the static flat-file,
no-database design the whole repo rests on. This is a standing decision, not an oversight - do
not add anything in this family later, however small it looks in isolation.

---

## Repo structure

```
CLAUDE.md          this file - working context
STATUS.md          running build log, append-only
docs/PLAN.md       the approved build plan
README.md  CONTRIBUTING.md  CODE_OF_CONDUCT.md  LICENSE

package.json       root: deps for scripts/ only (ajv, js-yaml, @clack/prompts, ...)

data/
  <root-slug>[/<sub-slug>/<sub-slug>/...]/<entry-slug>.yaml   root is one of the six life-domain
                                                               roots; depth below it is unbounded
  career/companies/<country-slug>/<company-slug>.yaml         nested under Career on disk too,
                                                               surfaced at /career/companies

taxonomy/
  categories.yaml  the open category/country registry

schema/
  link.schema.json     source of truth for link entries
  company.schema.json  source of truth for company entries

scripts/
  lib/                 all shared logic lives here; everything else imports it
    url.mjs            URL normalization (canonical form for duplicate checks)
    slugify.mjs        slug/tag normalization
    levenshtein.mjs    fuzzy-match distance, hand-rolled, zero deps
    taxonomy.mjs       registry read/write + fuzzy "did you mean" check
    yaml-io.mjs        read/write YAML data files
    favicon.mjs        build-time favicon fetch-and-cache (no third-party call at runtime)
  normalize-url.mjs    thin CLI wrapper over lib/url.mjs
  normalize-slug.mjs   thin CLI wrapper over lib/slugify.mjs + lib/taxonomy.mjs
  validate.mjs         validates the whole dataset - used by CI *and* locally
  add-link.mjs         interactive local CLI (npm run add-link)
  add-company.mjs      interactive local CLI (npm run add-company)
  gen-zod-schemas.mjs  codegen: schema/*.json -> site/src/schemas/generated/*.ts
  parse-issue-form.mjs parses a GitHub Issue Form body (used by issue-to-pr.yml)
  fetch-favicons.mjs   bulk favicon cache over the whole dataset (npm run fetch-favicons)

site/                  the Astro project (its own package.json)
  astro.config.mjs     site: 'https://sidequest.ibtisam-iq.com'
  public/CNAME         sidequest.ibtisam-iq.com
  public/favicons/<kind>/<slug>.<ext>   fetched by scripts/fetch-favicons.mjs, committed to git
  src/content.config.ts
  src/schemas/generated/   GENERATED - gitignored, never hand-edit
  src/lib/  src/components/  src/pages/

.github/
  ISSUE_TEMPLATE/add-link.yml  add-company.yml
  PULL_REQUEST_TEMPLATE.md
  workflows/validate.yml  issue-to-pr.yml  deploy.yml
```

---

## The two entity types

They are deliberately separate because they need different filtering. A company needs
country/industry/hiring-status facets that a generic tool entry has no use for. This is a data
and validation distinction only - **in the site's navigation, companies are not a top-level thing
next to the six roots**; they're a feature at `/career/companies`, since a company is itself a
kind of career-relevant resource. On disk, companies live nested inside the Career root
(`data/career/companies/`) rather than as a sibling top-level folder, matching where the site
surfaces them - only the routing/folder decision changed for this, not the schema or validation
below.

### 1. Links - `data/<root-slug>[/<sub-slug>/<sub-slug>/...]/<entry-slug>.yaml`

Generic entries: tools, repos, articles, books, courses, communities, job boards, referral links.
There is no `data/links/` wrapper folder - a link's file sits directly under one of the six root
folders, optionally nested arbitrarily deep beneath it. A category page's URL is its category
path with no prefix, e.g. `/technology/ai-coding-agents`.

| Field | Req | Notes |
|---|---|---|
| `url` | ✔ | canonical URL |
| `title` | ✔ | |
| `category` | ✔ | a path into `taxonomy/categories.yaml` - `root`, `root/sub`, or deeper, to any depth; `type: links` |
| `tags` | ✔ | array, min 1, free-form, normalized lowercase-kebab |
| `priority` | ✔ | `high` \| `medium` \| `low` |
| `date_added` | ✔ | **quoted** ISO date, e.g. `"2026-08-22"` |
| `source` | ✔ | `local` \| `issue-form` \| `pr` |
| `note` | | why you saved it / where you found it |
| `description` | | one-line description shown on the card |
| `added_by` | | GitHub username |
| `alternatives` | | array of **link** entry-slugs; powers the two-way alternatives feature |
| `audience` | | free-form array: `developers`, `non-technical`, `job-seekers`, `everyone`, ... |
| `legal_risk` | | boolean; required `true` under three specific categories - see below |

### 2. Companies - `data/career/companies/<country-slug>/<company-slug>.yaml`

| Field | Req | Notes |
|---|---|---|
| `name` | ✔ | |
| `website` | ✔ | |
| `country` | ✔ | normalized slug; must exist in the registry with `type: companies` |
| `industry` | ✔ | free-form, e.g. `fintech`, `saas`, `consulting` - **not** registered |
| `date_added` | ✔ | quoted ISO date |
| `source` | ✔ | `local` \| `issue-form` \| `pr` |
| `careers_url` | | |
| `hiring_status` | | `actively-hiring` \| `unknown` \| `not-hiring` |
| `size` | | `startup` \| `mid` \| `enterprise` |
| `rating` | | personal note on why it's notable |
| `tags` | | |
| `remote_policy` | | `remote` \| `hybrid` \| `onsite` \| `unknown` |

> **Relationship to the career repo.** The companies directory is conceptually adjacent to the
> job-applications company-scraper skill in the user's separate career repo. They are deliberately
> **separate projects** for now. Nothing here should be designed in a way that would conflict if
> they are connected later - so keep the company schema self-describing and avoid assuming any
> field is populated by this repo alone.

---

## The six root categories

Links are organized under **six fixed, durable life-domain roots** - not implementation
categories, not trend words:

**Career · Faith · Finance · Learning · Lifestyle · Technology**

Always shown in that alphabetical order in the nav - no manual reordering by perceived
importance, ever. There is deliberately **no "AI" root**: AI-related entries live under
Technology as subcategories (`technology/ai-coding-agents`, `technology/ai-chat-assistants`,
etc.), because "AI" is a trend word, not a life domain. These six roots replaced a flat,
implementation-shaped 13-category taxonomy (`dev-tools`, `ai-tools`, `fintech-payments`, ...) in
a full restructuring - old category folders no longer exist anywhere in `data/`.

### Classification precedence

When an entry could plausibly fit more than one root - which is common, since real bookmarks
rarely respect clean domain boundaries - apply this **exact ordered rule, first match wins**.
This applies to existing seed data, bulk imports, and future submissions alike, so categorization
stays consistent instead of being re-judged ad hoc every time:

1. **Explicitly religious content** → Faith, regardless of format (app, reference site, lecture).
2. **Entire purpose is structured teaching** - a course/curriculum/MOOC platform, regardless of
   subject taught → Learning.
3. **About jobs, hiring, running a business, freelancing, or professional advancement** → Career.
   (This is why ecommerce-seller-tools and business-research file under Career, not Technology -
   they're about *running* a business, which this rule catches before rule 5 would.)
4. **About moving, storing, or growing money** - payments, banking, crypto, invoicing → Finance.
5. **A tool, software, or technical reference used to build or operate something** → Technology.
6. **Everything else** - general productivity, entertainment, day-to-day utilities → Lifestyle.

**Shadow-library-style content** (Sci-Hub, Z-Library, LibGen, Anna's Archive, torrent/cracked-
software sites) is a deliberate, risk-understood inclusion, not an oversight - but it is filed by
**content type** under whichever root actually fits, not under its own root:
`learning/books-academic-papers` (books/papers), `lifestyle/movies-torrents` (movies/torrents),
`technology/cracked-software-apks` (cracked software). Every entry under exactly these three
categories requires `legal_risk: true`, enforced by `validate.mjs` in both directions - missing
where required, and rejected anywhere else - and rendered as a visible warning badge on the card
and entry page. See `scripts/lib/taxonomy.mjs`'s `LEGAL_RISK_REQUIRED_CATEGORIES` for the
authoritative list; `scripts/add-link.mjs` and `scripts/lib/issue-form.mjs` both import it from
there so the three can't drift.

## The open taxonomy system

Subcategories within each root are **not a fixed enum**. They grow as the directory grows,
without anyone hand-editing a schema - but the six roots themselves are fixed (see above); this
openness applies to what's underneath them.

`taxonomy/categories.yaml` is the registry. Each record:

```yaml
- slug: technology
  name: Technology
  type: links      # links | companies
- slug: ai-coding-agents
  name: AI Coding Agents
  type: links
  parent: technology
```

`parent` holds the **full path** of the immediate parent, not just its bare slug - so a category
nested two levels below a root (say `technology/dev-tools/kubernetes`) has `parent:
technology/dev-tools`. This is what makes depth genuinely unbounded without ambiguity: two
categories in different branches are free to reuse the same slug (a `documentation` subcategory
under two unrelated parents, say), because each is identified by its distinct full parent path
rather than by slug alone. For a root-level category, or the common two-level case, this is
identical to storing the bare root slug.

For **links**, the registry key is the category path, to any depth. For **companies**, the
registry key is the **country** (mirroring `data/career/companies/<country>/`); `industry` stays
free-form and unregistered, and the companies side of the registry is completely unaffected by
the six-root restructuring or by depth.

When `add-link.mjs` / `add-company.mjs` is given a subcategory that doesn't exist yet it:

1. normalizes it (lowercase, kebab-case);
2. **fuzzy-matches it against its siblings only** (Levenshtein; warns at distance ≤2 or
   normalized ratio <0.3) - other subcategories of the same immediate parent, or other top-level
   roots if you're somehow proposing a new one - so the taxonomy doesn't fragment into
   near-duplicates *within a parent* - *"did you mean 'ai-chat-assistants'? you typed
   'ai-chat-assistant'"*;
3. if confirmed genuinely new, adds it to the registry and creates the data folder.

A subcategory named after an old flat top-level category (e.g. `technology/dev-tools`,
`technology/ai-tools`) is a **generic catch-all bucket** for entries that don't fit a more
specific sibling subcategory - it is not a sign the hierarchy needs to be deeper. Depth below a
root is **unbounded** - a category may itself have children, which may have their own, and so on
- but a new level should only be added when a specific subcategory genuinely outgrows it, not by
default. The site's top nav (the mega-menu) only ever shows a root's immediate children on
hover/tap regardless of how deep the real tree goes underneath; deeper levels are reached by
clicking into a category page and browsing further, never by cascading hover flyouts. A category
page that itself has children shows them as a clickable grid; a leaf category shows its own
entries.

**Tags are fully free-form** - no registry, just normalized to lowercase-kebab. Tags are meant to
be broader and more numerous than categories.

### Entry counts are computed, never stored

The registry holds only `slug`/`name`/`type`/`parent`. Counts are computed at build time by the
site and by `npm run validate -- --report`. This is deliberate: a stored count would put every
single-entry PR on the same line of one shared file, guaranteeing merge conflicts between
concurrent issue-form PRs.

---

## Key conventions and decisions

- **Dates are quoted ISO strings** (`date_added: "2026-08-22"`). js-yaml 5's default YAML-1.2 CORE
  schema does not coerce timestamps; quoting makes parsing identical under js-yaml and Astro and
  matches JSON Schema `format: date`. Never write a bare unquoted date.
- **Slug uniqueness is per collection** - unique across every link file under `data/` (excluding
  the companies subtree), and separately unique within `data/career/companies/**`. A link and a
  company may share a slug. `alternatives` only ever references links, so cross-collection
  collision is harmless.
- **`alternatives` uses bare entry slugs** (`alternatives: [obsidian]`, not `ai-tools/obsidian`),
  which is what per-collection uniqueness buys us. The relationship is rendered **bidirectionally**:
  if A lists B, B's page also shows A. The reverse map is computed once per build from the full
  dataset.
- **URLs have no "links" or "companies" segment.** A category page's URL is its category path
  verbatim (`/technology/ai-coding-agents`), served by a single catch-all route
  (`site/src/pages/[...path].astro`) that resolves against `taxonomy/categories.yaml` at any
  depth - there is no per-depth route file. An entry page is `/entry/<slug>` (link slugs are
  unique dataset-wide, so this never needs the category in the URL). The "browse everything"
  page is `/browse`, not `/links`. Companies keep their own explicit routes under
  `/career/companies/**`, which win over the catch-all because Astro prioritises static routes
  over a rest-parameter one.
- **Favicons are fetched once and committed, never requested live.** `scripts/lib/favicon.mjs`
  saves each entry's icon to `site/public/favicons/<kind>/<slug>.<ext>` (namespaced by collection,
  for the same reason slugs are per-collection above). `Favicon.astro` checks that path at build
  time and falls back to a letter initial if nothing is cached - there is no third-party favicon
  URL anywhere in the rendered page. Resolve the favicons directory from `process.cwd()` in Astro
  components, not `import.meta.url` - Astro/Vite rewrites a component's `import.meta.url` to a
  virtual module id, which makes `existsSync` silently find nothing even when the file is real.
  `deploy.yml` commits any newly-fetched favicon back to `main` as `github-actions[bot]`, with a
  CI-skip marker in the message so that push doesn't retrigger the same workflow - GitHub
  recognises that marker natively for push-triggered runs. The step never blocks the deploy: it
  only affects whether a future run has to refetch that one icon, not whether this run ships
  correctly.

  **Hazard, found the hard way:** that marker is a plain substring match against the whole commit
  message, not just a leading tag. Writing your own commit describing this mechanism in prose -
  even inside a sentence explaining what it does - trips the same detection and silently skips
  every workflow for that push, with no error anywhere. It happened once while documenting this
  exact feature: the commit landed, nothing ran, and it needed a manual `gh workflow run
  deploy.yml` to recover. When writing about this feature, spell the marker with a space inside
  the brackets, or describe it without reproducing it exactly.
- **JSON Schema is the single source of truth.** `schema/*.json` is authoritative and is what
  `validate.mjs` enforces via ajv. The Astro zod schemas in `site/src/schemas/generated/` are
  **generated** from it by `scripts/gen-zod-schemas.mjs` (wired as `predev`/`prebuild`), are
  gitignored, and must never be hand-edited. This removes dual-schema drift.
- **All shared logic lives in `scripts/lib/`** and is imported by `validate.mjs`, both CLIs, and
  `parse-issue-form.mjs`. Never reimplement normalization in a workflow YAML or duplicate it in a
  second script - CI and local must run the identical code.
- **Two independent `package.json` files** (root for scripts, `site/` for Astro). No workspaces in
  v1, so each CI job installs only what it needs.

---

## How to run things

### Local development

```bash
npm install              # root deps, for scripts/
npm run validate         # validate the entire dataset
npm run validate -- --report   # validate + print per-category entry counts
npm run add-link         # interactive: add a link entry
npm run add-company      # interactive: add a company entry
npm test                 # node --test over scripts/lib pure functions
```

### The site

```bash
cd site
npm install
npm run dev              # Astro dev server
npm run build            # astro build && pagefind --site dist
npm run preview          # serve the built site
```

> **Search does not work under `astro dev`.** Pagefind indexes *built* HTML, so the index only
> exists after `npm run build`. To test search, build and then `npm run preview`. This is expected,
> not a bug.

---

## What each script does

| Script | Purpose |
|---|---|
| `scripts/validate.mjs` | The gate. Validates every file in `data/**` against its JSON Schema; checks duplicate normalized URLs dataset-wide; checks each entry's category/country exists in the registry; checks `alternatives` point at real link slugs; checks per-collection slug uniqueness; checks the folder path matches the entry's `category`/`country` field. Modes: default, `--report`, `--check-duplicate-url <url>`. |
| `scripts/add-link.mjs` | Interactive local CLI for a new link. Runs the fuzzy category check before writing, re-validates after. |
| `scripts/add-company.mjs` | Same, for a company. |
| `scripts/normalize-url.mjs` | CLI wrapper over `lib/url.mjs` - prints the canonical form of a URL. |
| `scripts/normalize-slug.mjs` | CLI wrapper over `lib/slugify.mjs` + `lib/taxonomy.mjs` - normalizes and fuzzy-checks a slug. |
| `scripts/gen-zod-schemas.mjs` | Generates the Astro zod schemas from `schema/*.json`. Runs automatically via `predev`/`prebuild`. |
| `scripts/parse-issue-form.mjs` | Parses a GitHub Issue Form markdown body into entry fields. Used only by `issue-to-pr.yml`. |
| `scripts/fetch-favicons.mjs` | Fetches and caches a favicon for every entry that doesn't already have one in `site/public/favicons/<kind>/<slug>.<ext>`. Concurrency-limited, skips anything already cached, never fails the build over one dead site. `--force` refetches everything. Runs in `deploy.yml` before the Astro build, and per-entry inside `writeAndValidate` (shared by both add CLIs) right after writing. |

---

## GitHub Actions

| Workflow | Trigger | Does |
|---|---|---|
| `validate.yml` | PR touching `data/**`, `taxonomy/**`, `schema/**` | Runs `node scripts/validate.mjs`. The PR gate. |
| `issue-to-pr.yml` | Issue opened with label `new-link` / `new-company` | Parses the form → normalizes → duplicate-checks → writes YAML → validates → opens a PR. |
| `deploy.yml` | Push to `main` | Validates **first** (fail = stop, no deploy) → fetches and commits any uncached favicons → Astro build + Pagefind → deploy to Pages. |

All three shell out to the **same** `scripts/validate.mjs` a contributor runs locally, so CI and
local can't drift.

### Required repository labels

The issue forms apply `new-link` / `new-company`, and `issue-to-pr.yml` routes on exactly those
labels - so **the labels must exist in the repo or the whole pipeline silently never triggers**.
GitHub does not create them automatically from the form definition. If you fork this repo, run:

```bash
gh label create new-link     --color 1D76DB --description "Issue-form submission for a new link entry"
gh label create new-company  --color 0E8A16 --description "Issue-form submission for a new company entry"
gh label create automated-pr --color 5319E7 --description "PR opened automatically from an issue form"
```

### Bot-created PRs need the checks approved once

GitHub deliberately does not auto-run workflows on PRs opened by `GITHUB_TOKEN` - it prevents a
workflow from recursively triggering itself. So `validate.yml` on an issue-form PR sits at
**`action_required`** until a maintainer clicks *Approve and run* (or
`gh api --method POST repos/:owner/:repo/actions/runs/<id>/approve`).

This is friction, not a hole. That data is validated three times regardless:

1. `issue-to-pr.yml` runs `validate.mjs` **before** it opens the PR, so a broken entry never
   becomes a PR at all;
2. `validate.yml` runs on `push` to `main`, after merge;
3. `deploy.yml` validates before building - a failure stops the deploy, so a bad entry cannot
   reach the live site.

Requiring a PAT instead would remove the click but ties the pipeline to one person's token.

### Security note for `issue-to-pr.yml`

Issue bodies are untrusted input from anyone on the internet. Two rules:

1. The issue body is passed to Node via **`env:`**, never interpolated into a shell string -
   `${{ github.event.issue.body }}` inside a `run:` is a script-injection hole.
2. The output filename is always derived from the **normalized slug** (`[a-z0-9-]` only), never
   from raw user text, so a crafted title cannot traverse paths.

A fuzzy category near-match in this automated context is a **note in the PR body, not a job
failure** - a human reviewer decides.

---

## Writing style

Do not use em dashes (the "—" character) or en dashes (the "–" character) anywhere in this repo:
prose, comments, commit messages, docs, numeric ranges (write `8-10`, not `8–10`). Use a plain
hyphen, a comma, a colon, or split into a new sentence instead. Dash-heavy prose reads as
AI-generated. This applies everywhere text is written for this project, not just user-facing
copy.

## Verifying work

A green build or a passing typecheck is **not** sufficient evidence that a feature works. Site
changes must be exercised in a real browser (desktop **and** ~375px mobile) before being called
done: search, every filter chip, category nav, the companies facets, alternatives resolving in
both directions, dark mode toggling and persisting without a flash, and no console errors.
