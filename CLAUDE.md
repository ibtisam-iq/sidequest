# CLAUDE.md — working context for sidequest

Read this file first. It is the complete working context for this repo; you should not need
anything re-explained by the user to start being useful.

Companion file: **`STATUS.md`** is the running build log — what has actually been done so far,
appended after every meaningful chunk of work. Read it second to learn the current state.
**`docs/PLAN.md`** is the approved build plan.

---

## What this project is

**sidequest** is an open-source, git-backed personal directory for saving anything interesting
found while browsing: tools (dev, AI, PDF, CV, browsers, day-to-day — anything), GitHub repos,
articles, books, courses, communities, remote job boards, referral links — plus a dedicated
**companies** directory (tech companies worth knowing about, organized by country, starting with
Pakistan and expanding to US/Canada/remote).

Inspiration is Awesome Lists and free-for.dev. The reason it exists as a real project rather than
a markdown list is the two things a markdown list cannot do:

1. **Scale** — hundreds of categories and thousands of entries, without a slow build or an
   unusable UI.
2. **A premium look** — a polished directory product, not a README rendered as HTML.

Live at **https://sidequest.ibtisam-iq.com** (GitHub Pages, custom domain).

### Core design constraints

- **Data is flat YAML files in git. There is no database.** Every feature must work within that.
- **Static output only.** No server at runtime — it is GitHub Pages.
- **Two contribution paths, both first-class:**
  1. The owner edits/adds YAML locally on their Mac and pushes directly.
  2. Anyone (owner included, e.g. from a phone) submits a GitHub Issue Form, which auto-opens a PR.

### Explicitly out of scope — do not add

Bookmark counts, upvote counts, "verified" badges, and any user-facing engagement, account, or
chat feature. Each requires user accounts and a backend, which contradicts the static flat-file,
no-database design the whole repo rests on. This is a standing decision, not an oversight — do
not add anything in this family later, however small it looks in isolation.

---

## Repo structure

```
CLAUDE.md          this file — working context
STATUS.md          running build log, append-only
docs/PLAN.md       the approved build plan
README.md  CONTRIBUTING.md  CODE_OF_CONDUCT.md  LICENSE

package.json       root: deps for scripts/ only (ajv, js-yaml, @clack/prompts, ...)

data/
  links/<category-slug>/<entry-slug>.yaml
  companies/<country-slug>/<company-slug>.yaml

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
  normalize-url.mjs    thin CLI wrapper over lib/url.mjs
  normalize-slug.mjs   thin CLI wrapper over lib/slugify.mjs + lib/taxonomy.mjs
  validate.mjs         validates the whole dataset — used by CI *and* locally
  add-link.mjs         interactive local CLI (npm run add-link)
  add-company.mjs      interactive local CLI (npm run add-company)
  gen-zod-schemas.mjs  codegen: schema/*.json -> site/src/schemas/generated/*.ts
  parse-issue-form.mjs parses a GitHub Issue Form body (used by issue-to-pr.yml)

site/                  the Astro project (its own package.json)
  astro.config.mjs     site: 'https://sidequest.ibtisam-iq.com'
  public/CNAME         sidequest.ibtisam-iq.com
  src/content.config.ts
  src/schemas/generated/   GENERATED — gitignored, never hand-edit
  src/lib/  src/components/  src/pages/

.github/
  ISSUE_TEMPLATE/add-link.yml  add-company.yml
  PULL_REQUEST_TEMPLATE.md
  workflows/validate.yml  issue-to-pr.yml  deploy.yml
```

---

## The two entity types

They are deliberately separate because they need different filtering. A company needs
country/industry/hiring-status facets that a generic tool entry has no use for.

### 1. Links — `data/links/<category-slug>/<entry-slug>.yaml`

Generic entries: tools, repos, articles, books, courses, communities, job boards, referral links.

| Field | Req | Notes |
|---|---|---|
| `url` | ✔ | canonical URL |
| `title` | ✔ | |
| `category` | ✔ | must exist in `taxonomy/categories.yaml` with `type: links` |
| `tags` | ✔ | array, min 1, free-form, normalized lowercase-kebab |
| `priority` | ✔ | `high` \| `medium` \| `low` |
| `date_added` | ✔ | **quoted** ISO date, e.g. `"2026-08-22"` |
| `source` | ✔ | `local` \| `issue-form` \| `pr` |
| `note` | | why you saved it / where you found it |
| `description` | | one-line description shown on the card |
| `added_by` | | GitHub username |
| `alternatives` | | array of **link** entry-slugs; powers the two-way alternatives feature |
| `audience` | | free-form array: `developers`, `non-technical`, `job-seekers`, `everyone`, ... |

### 2. Companies — `data/companies/<country-slug>/<company-slug>.yaml`

| Field | Req | Notes |
|---|---|---|
| `name` | ✔ | |
| `website` | ✔ | |
| `country` | ✔ | normalized slug; must exist in the registry with `type: companies` |
| `industry` | ✔ | free-form, e.g. `fintech`, `saas`, `consulting` — **not** registered |
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
> they are connected later — so keep the company schema self-describing and avoid assuming any
> field is populated by this repo alone.

---

## The open taxonomy system

Categories are **not a fixed enum**. They grow as the directory grows, without anyone hand-editing
a schema.

`taxonomy/categories.yaml` is the registry. Each record:

```yaml
- slug: ai-tools
  name: AI Tools
  type: links      # links | companies
```

For **links**, the registry key is the category. For **companies**, the registry key is the
**country** (mirroring `data/companies/<country>/`); `industry` stays free-form and unregistered.

When `add-link.mjs` / `add-company.mjs` is given a category that doesn't exist yet it:

1. normalizes it (lowercase, kebab-case);
2. **fuzzy-matches it against existing categories** (Levenshtein; warns at distance ≤2 or
   normalized ratio <0.3) so the taxonomy doesn't fragment into near-duplicates — *"did you mean
   'ai-tools'? you typed 'ai-tool'"*;
3. if confirmed genuinely new, adds it to the registry and creates the data folder.

**Tags are fully free-form** — no registry, just normalized to lowercase-kebab. Tags are meant to
be broader and more numerous than categories.

### Entry counts are computed, never stored

The registry holds only `slug`/`name`/`type`. Counts are computed at build time by the site and by
`npm run validate -- --report`. This is deliberate: a stored count would put every single-entry PR
on the same line of one shared file, guaranteeing merge conflicts between concurrent issue-form PRs.

---

## Key conventions and decisions

- **Dates are quoted ISO strings** (`date_added: "2026-08-22"`). js-yaml 5's default YAML-1.2 CORE
  schema does not coerce timestamps; quoting makes parsing identical under js-yaml and Astro and
  matches JSON Schema `format: date`. Never write a bare unquoted date.
- **Slug uniqueness is per collection** — unique within `data/links/**`, and separately unique
  within `data/companies/**`. A link and a company may share a slug. `alternatives` only ever
  references links, so cross-collection collision is harmless.
- **`alternatives` uses bare entry slugs** (`alternatives: [obsidian]`, not `ai-tools/obsidian`),
  which is what per-collection uniqueness buys us. The relationship is rendered **bidirectionally**:
  if A lists B, B's page also shows A. The reverse map is computed once per build from the full
  dataset.
- **JSON Schema is the single source of truth.** `schema/*.json` is authoritative and is what
  `validate.mjs` enforces via ajv. The Astro zod schemas in `site/src/schemas/generated/` are
  **generated** from it by `scripts/gen-zod-schemas.mjs` (wired as `predev`/`prebuild`), are
  gitignored, and must never be hand-edited. This removes dual-schema drift.
- **All shared logic lives in `scripts/lib/`** and is imported by `validate.mjs`, both CLIs, and
  `parse-issue-form.mjs`. Never reimplement normalization in a workflow YAML or duplicate it in a
  second script — CI and local must run the identical code.
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
| `scripts/normalize-url.mjs` | CLI wrapper over `lib/url.mjs` — prints the canonical form of a URL. |
| `scripts/normalize-slug.mjs` | CLI wrapper over `lib/slugify.mjs` + `lib/taxonomy.mjs` — normalizes and fuzzy-checks a slug. |
| `scripts/gen-zod-schemas.mjs` | Generates the Astro zod schemas from `schema/*.json`. Runs automatically via `predev`/`prebuild`. |
| `scripts/parse-issue-form.mjs` | Parses a GitHub Issue Form markdown body into entry fields. Used only by `issue-to-pr.yml`. |

---

## GitHub Actions

| Workflow | Trigger | Does |
|---|---|---|
| `validate.yml` | PR touching `data/**`, `taxonomy/**`, `schema/**` | Runs `node scripts/validate.mjs`. The PR gate. |
| `issue-to-pr.yml` | Issue opened with label `new-link` / `new-company` | Parses the form → normalizes → duplicate-checks → writes YAML → validates → opens a PR. |
| `deploy.yml` | Push to `main` | Validates **first** (fail = stop, no deploy) → Astro build + Pagefind → deploy to Pages. |

All three shell out to the **same** `scripts/validate.mjs` a contributor runs locally, so CI and
local can't drift.

### Required repository labels

The issue forms apply `new-link` / `new-company`, and `issue-to-pr.yml` routes on exactly those
labels — so **the labels must exist in the repo or the whole pipeline silently never triggers**.
GitHub does not create them automatically from the form definition. If you fork this repo, run:

```bash
gh label create new-link     --color 1D76DB --description "Issue-form submission for a new link entry"
gh label create new-company  --color 0E8A16 --description "Issue-form submission for a new company entry"
gh label create automated-pr --color 5319E7 --description "PR opened automatically from an issue form"
```

### Bot-created PRs need the checks approved once

GitHub deliberately does not auto-run workflows on PRs opened by `GITHUB_TOKEN` — it prevents a
workflow from recursively triggering itself. So `validate.yml` on an issue-form PR sits at
**`action_required`** until a maintainer clicks *Approve and run* (or
`gh api --method POST repos/:owner/:repo/actions/runs/<id>/approve`).

This is friction, not a hole. That data is validated three times regardless:

1. `issue-to-pr.yml` runs `validate.mjs` **before** it opens the PR, so a broken entry never
   becomes a PR at all;
2. `validate.yml` runs on `push` to `main`, after merge;
3. `deploy.yml` validates before building — a failure stops the deploy, so a bad entry cannot
   reach the live site.

Requiring a PAT instead would remove the click but ties the pipeline to one person's token.

### Security note for `issue-to-pr.yml`

Issue bodies are untrusted input from anyone on the internet. Two rules:

1. The issue body is passed to Node via **`env:`**, never interpolated into a shell string —
   `${{ github.event.issue.body }}` inside a `run:` is a script-injection hole.
2. The output filename is always derived from the **normalized slug** (`[a-z0-9-]` only), never
   from raw user text, so a crafted title cannot traverse paths.

A fuzzy category near-match in this automated context is a **note in the PR body, not a job
failure** — a human reviewer decides.

---

## Verifying work

A green build or a passing typecheck is **not** sufficient evidence that a feature works. Site
changes must be exercised in a real browser (desktop **and** ~375px mobile) before being called
done: search, every filter chip, category nav, the companies facets, alternatives resolving in
both directions, dark mode toggling and persisting without a flash, and no console errors.
