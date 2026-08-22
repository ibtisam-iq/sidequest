# Build sidequest — a scalable personal directory system

## Context

`ibtisam-iq/sidequest` is currently an empty repo (LICENSE + `.git` only). The goal is an
open-source, git-backed personal directory for anything interesting found while browsing —
tools, GitHub repos, articles, books, courses, communities, remote job boards, referral links —
plus a dedicated **companies** directory (tech companies worth knowing, by country, starting
with Pakistan).

Inspiration is Awesome Lists / free-for.dev, but the point of building it rather than keeping a
markdown list is the two things a markdown list can't do: **scale** (hundreds of categories,
thousands of entries, without a slow build or unusable UI) and **a premium look** (a real
directory product, not a README rendered as HTML).

Data is flat YAML in git — no database. Two contribution paths must both work: the owner editing
YAML locally and pushing, and anyone (including the owner from a phone) submitting a GitHub Issue
Form that auto-opens a PR. Deployed static to GitHub Pages at `sidequest.ibtisam-iq.com`.

## Verified environment facts

Checked against the live npm registry and the Astro 7 tarball, not assumed:

- **Astro 7.2.4** is current and requires **Node ≥22.12.0** (local is v25.6.0 ✓). CI pins Node 22.
- Astro 7 still ships `astro/loaders` (`glob`, `file`) and `astro/zod`. The Content Layer API is
  the right mechanism, and `glob({ base })` accepts an **absolute file URL outside the site root** —
  this is what lets Astro read repo-root `data/` without copying or symlinking.
- `.yaml`/`.yml` is a **registered data entry type in Astro core** (`core/config/settings.js`), so
  the glob loader parses YAML natively. No custom parser needed for the entry collections.
- **js-yaml 5.3.0** is current (4.x is now `v4-legacy`), is ESM-native, and still exports
  `load`/`dump`. Its default load schema is YAML-1.2 CORE, which does **not** coerce timestamps —
  so all dates are stored as **quoted ISO strings** (`date_added: "2026-08-22"`), which parses
  identically under both js-yaml and Astro and matches JSON Schema `format: date`.
- Also current: pagefind 1.5.2, ajv 8.20.0, ajv-formats 3.0.1, @clack/prompts 1.7.0,
  json-schema-to-zod 2.8.1, @astrojs/sitemap 3.7.3 (declares no peer range, so it installs cleanly
  against Astro 7 — verify at build time; fallback is a hand-rolled prerendered `sitemap.xml.ts`,
  which is a few lines).
- `gh` 2.97.0 is authenticated as `ibtisam-iq` with `repo` + `workflow` scopes, so workflow files
  can be pushed without extra token setup.

## Decisions made with the user

1. **Category counts are computed, never stored.** `taxonomy/categories.yaml` holds only
   `slug`/`name`/`type`. The site computes counts at build time; `npm run validate -- --report`
   prints them. This avoids every single-entry PR touching the same line of one shared file.
2. **Homepage is a curated landing page** — hero, big search, category grid, featured/recent
   entries, stats. Exhaustive browsing lives on `/links` and `/companies`, not the homepage.
3. **Push to main freely; ask first** before opening the public test issue and before changing the
   GitHub Pages repo setting.
4. **Before the first commit**, create `.claude/settings.json` with `includeCoAuthoredBy: false`
   so no commit or PR body carries a `Co-Authored-By` / "Generated with Claude Code" trailer.
   **This is verified, not assumed** — see Phase 1.
5. **This plan is committed to the repo** as `docs/PLAN.md` in Phase 1, so it survives this session
   and any future agent can read it back. The `/tmp` copy is scratch.
6. **Slug uniqueness is scoped per collection**, not global — unique within `data/links/**` and
   unique within `data/companies/**` separately. `alternatives` only ever references links, so
   there's no reason to stop a link and a company from sharing a slug.

Additional judgment calls I'm making:

7. `glob`'s `generateId` returns the bare filename, so `alternatives: [obsidian]` is a
   human-writable reference rather than `ai-tools/obsidian`. `validate.mjs` enforces the
   per-collection uniqueness that makes this unambiguous.
8. **JSON Schema is the single source of truth.** `scripts/gen-zod-schemas.mjs` generates the
   Astro zod schemas from `schema/*.json` via `json-schema-to-zod`, wired as `predev`/`prebuild`.
   Generated output is gitignored and never hand-edited — this removes the dual-schema drift risk.
9. **One taxonomy registry** for both entity types, keyed by `type: links|companies`. For
   companies the registry key is **country** (mirroring `data/companies/<country>/`); industry
   stays free-form and unregistered.
10. **Two independent `package.json` files** (root for scripts, `site/` for Astro) — no workspaces
    in v1, so CI jobs install only what they need.

## Explicitly out of scope

Bookmark counts, upvote counts, "verified" badges, and any user-facing engagement, account, or chat
feature are **rejected by decision, not oversight**. Each requires user accounts and a backend,
which contradicts the static flat-file, no-database design the whole repo rests on. Do not add
anything in this family later, however small it looks in isolation.

## Repo structure

```
CLAUDE.md  STATUS.md  README.md  CONTRIBUTING.md  CODE_OF_CONDUCT.md  LICENSE
package.json                     # ajv, ajv-formats, js-yaml, @clack/prompts, json-schema-to-zod
data/links/<category>/<slug>.yaml
data/companies/<country>/<slug>.yaml
taxonomy/categories.yaml
schema/link.schema.json  schema/company.schema.json
scripts/
  lib/{yaml-io,slugify,levenshtein,taxonomy,url}.mjs   # all shared logic lives here
  normalize-url.mjs  normalize-slug.mjs                 # thin CLI wrappers over lib/
  validate.mjs  add-link.mjs  add-company.mjs
  gen-zod-schemas.mjs  parse-issue-form.mjs
  lib/*.test.mjs                                        # node --test, pure functions
site/
  astro.config.mjs                # site: 'https://sidequest.ibtisam-iq.com'
  public/CNAME                    # sidequest.ibtisam-iq.com
  src/content.config.ts  src/schemas/generated/  src/lib/  src/components/  src/pages/
.github/
  ISSUE_TEMPLATE/{add-link,add-company}.yml
  PULL_REQUEST_TEMPLATE.md
  workflows/{validate,issue-to-pr,deploy}.yml
```

## Build phases

STATUS.md gets an appended entry after **every** phase — timestamp, phase/percentage, what was
built or decided, what's next. Never overwrite prior entries. Each phase ends in its own commit.

### Phase 1 — Scaffold
`.claude/settings.json` (`includeCoAuthoredBy: false`) **first**, then CLAUDE.md (project purpose,
full structure, both entity schemas, how the open taxonomy works, dev/validate commands, what each
script does, conventions), STATUS.md entry #1, CODE_OF_CONDUCT.md (Contributor Covenant), root
`package.json`, `.gitignore`, and **`docs/PLAN.md`** — this plan, committed into the repo so it
outlives the session and any future agent can read it back.

**Hard gate after the first commit:** run `git log -1` and confirm there is no `Co-Authored-By`
trailer. If one is present, **stop and fix the setting before making any further commits** — this
gets caught on commit #1, not discovered across dozens of commits later.

CLAUDE.md must note that the companies directory is conceptually adjacent to the company-scraper
skill in the user's separate career repo, but is a deliberately independent project — nothing here
should be designed in a way that would conflict if they're linked later.

### Phase 2 — Schemas, taxonomy, seed data
`schema/link.schema.json` and `schema/company.schema.json` per the specced required/optional
fields, `additionalProperties: false`, `format: date` on dates and `format: uri` on URLs.

Seed `taxonomy/categories.yaml` with 10 link categories spanning the real spread —
`dev-tools`, `ai-tools`, `github-repos`, `articles`, `books`, `courses`, `communities`,
`remote-job-boards`, `referral-links`, `newsletters` — plus `pakistan` as the first company country.

8–10 real seed entries (a mix of links and companies, at least two wired as mutual `alternatives`)
to prove the schemas out against actual data rather than placeholders.

### Phase 3 — Shared libs + validation
`scripts/lib/*` first, since everything else imports it: `url.mjs` (strip tracking params, lowercase
host, drop trailing slash — the canonical form all duplicate checks compare), `slugify.mjs`,
`levenshtein.mjs` (hand-rolled ~20 lines, zero deps, since CI and the CLI both use it),
`taxonomy.mjs` (registry read/write + fuzzy check, warn at distance ≤2 or normalized ratio <0.3),
`yaml-io.mjs`.

`validate.mjs` checks: every file against its JSON Schema (ajv + ajv-formats), duplicate normalized
URLs dataset-wide, category/country exists in the registry, `alternatives` point at real link
slugs, **slug uniqueness within each collection separately** (links vs companies — a collision
across the two is fine), and folder path matches the entry's `category`/`country` field. Modes:
default, `--report` (counts), `--check-duplicate-url <url>` (used by the issue workflow).

**Verify by deliberately breaking things**: a schema-invalid entry, a duplicate URL, a dangling
`alternatives` ref, and an unregistered category — confirm each is caught with a clear message,
then revert. Add `node --test` coverage for the pure lib functions.

### Phase 4 — Interactive CLIs
`add-link.mjs` / `add-company.mjs` using `@clack/prompts` (local-only, never in CI, so the UX
dependency is worth it). Both run the fuzzy category check before writing and re-run validation
after. **Verify the fuzzy warning actually fires** by typing `ai-tool` against the existing
`ai-tools` and confirming the "did you mean" prompt appears.

### Phase 5 — Astro site
`site/src/content.config.ts` with three collections: `links` and `companies` via
`glob({ pattern: '**/*.yaml', base: new URL('../../data/…', import.meta.url), generateId })`, and
`categories` via `file()` on the registry. Add `vite.server.fs.allow: ['..']` so dev can read
outside the site root.

Pages, all statically generated:
- `/` — curated landing page (hero, search, category grid, featured + recent, stats)
- `/links` and `/links/[category]/[...page]` — `paginate()` at 24/page, with entries grouped into a
  Map **once** before iterating categories (O(n), not O(n×categories) — this is the difference
  between a fast and a slow build at scale)
- `/companies` and `/companies/[country]/[...page]`
- `/links/[category]/entry/[slug]` and `/companies/[country]/entry/[slug]` — the `entry/` segment
  keeps detail routes from colliding with the paginated route's numeric suffix
- `/api/entries.json` — `prerender = true`, the full dataset as a static file powering client-side
  filter chips and load-more on the browse pages

Facet filtering (category/tag/priority/type on `/links`; country/industry/hiring_status/
remote_policy on `/companies`) runs client-side against that JSON — generating a static page per
filter combination would explode combinatorially.

**SEO and discoverability** — this is a public directory meant to be found, not just a personal tool:
- `@astrojs/sitemap` for an XML sitemap, plus `robots.txt` pointing at it
- Per-page `<title>`, meta description, and OG/Twitter tags on the homepage, category pages, and
  entry pages — driven from each entry's real data, not a shared default
- A real `src/pages/404.astro` with its own `<title>`, a self-referential canonical, and `noindex`
  — not a clone of the homepage. Astro does genuine per-page SSG, so this is just an ordinary page
  file. Deliberately **not** replicating the build-time metadata-generation machinery from
  `ibtisam-iq/portfolio-site` / `ibtisam-iq/projects` — those need it only because they're
  client-rendered SPAs synthesizing per-route metadata after the fact. That complexity buys
  nothing here.
- `llms.txt` at the site root: a short plain-text description of what sidequest is and how its data
  is structured, for AI agents and crawlers
- JSON-LD structured data (schema.org `CollectionPage` / `ItemList`) on the homepage and category
  pages

**Card UX** — cards carry icon/logo, title, one-line description, and tag pills beneath (confirmed
as the right layout). Two cheap additions: a **"New" badge** on entries with `date_added` inside the
last ~14 days, and a **Popular/Recent sort toggle** on `/links` and `/companies` alongside the
homepage's featured/recent section. Both are cosmetic — if either turns out to tangle the
client-side filter-chip logic, drop it rather than complicating that code path.

Design pass is real, not an afterthought: CSS-variable token system, considered typography scale
and spacing rhythm, distinct visual treatment for priority and entity type, proper hover/focus
states. Search is Pagefind (`@pagefind/default-ui`), themed through its CSS custom properties,
with `data-pagefind-body` on entry content and `data-pagefind-ignore` on nav/footer/chrome.
Build chain is `astro build && pagefind --site dist` — Pagefind indexes built HTML, so it must run
after Astro, and search therefore does not work under `astro dev` (document this in CONTRIBUTING).

### Phase 6 — Alternatives, dark mode, responsive
`site/src/lib/alternatives.ts` builds the bidirectional map **once per build** (module-level memo,
O(n) total) — forward refs unioned with reverse refs, so if A lists B, B's page shows A.

Dark mode: CSS variables at `:root`, `@media (prefers-color-scheme: dark)` scoped to
`:root:not([data-theme])` as the system default, `:root[data-theme='dark']` for an explicit choice,
plus a blocking inline `<script is:inline>` in `<head>` reading localStorage to avoid a flash of
wrong theme. Three-state toggle (light/dark/system), zero dependencies.

### Phase 7 — Issue Forms + Actions
Two issue forms with structured fields and auto-applied labels (`new-link` / `new-company`).

`scripts/parse-issue-form.mjs` parses the `### label\n\nvalue` markdown body in our own tested code
rather than depending on a marketplace parser. **Security-critical**: the untrusted issue body is
passed via `env:`, never interpolated into a shell string, and the output filename is always derived
from the normalized slug (`[a-z0-9-]` only) so a malicious title can't traverse paths.

`issue-to-pr.yml`: parse → normalize → duplicate check (comment on the issue and stop, no PR, if the
URL already exists) → write YAML, registering a genuinely-new category → run the **same**
`scripts/validate.mjs` → open the PR with `peter-evans/create-pull-request@v6` (handles idempotent
branch reuse so editing the issue doesn't spam duplicate PRs), body `Closes #N`. A fuzzy category
near-match is a **note in the PR body, not a job failure** — a human reviewer decides.

`validate.yml`: PR gate on `data/**`, `taxonomy/**`, `schema/**` → `node scripts/validate.mjs`.
`deploy.yml`: on push to main → validate first (fail = stop, no deploy) → Astro build + Pagefind →
`upload-pages-artifact` / `deploy-pages`. All three shell out to the identical script a contributor
runs locally, so CI and local can't drift.

### Phase 8 — Pages + domain
`public/CNAME`, `astro.config.mjs` site URL. Enabling Pages is a repo-settings change — **ask before
doing it**. Report the exact DNS record needed at the end; do not assume it's configured.

### Phase 9 — Docs
README (what it is, live link, structure, quick start) and CONTRIBUTING (both contribution paths in
detail, how the open taxonomy registry works for proposing new categories, why search is dev-only
absent, local validate instructions).

### Phase 10 — Final STATUS.md entry
Full state summary, known gaps, follow-ups. Refresh `docs/PLAN.md` if the build diverged from it,
so the committed plan matches what actually got built.

## Verification — required before calling anything done

A green build or passing typecheck is **not** sufficient evidence. Before reporting completion:

**Browser (dev server + real Chromium, desktop and 375px mobile viewport):**
- Pagefind search returns correct results — note this needs a preview of the *built* site, not `astro dev`
- Every filter chip works: category, tag, priority, entity type
- Category nav stays usable and grouped/collapsible, not one flat list
- Companies directory filters correctly by country, industry, hiring_status, remote_policy
- Alternatives resolve **in both directions** — confirm on the seeded mutual pair that B's page
  shows A even though only A declares the link
- Dark mode toggles correctly, persists across reload, and shows no flash of wrong theme
- "New" badge appears only on recent entries; Popular/Recent toggle reorders correctly
- 404 page renders its own title and `noindex`, and is not a homepage clone
- Sitemap, `robots.txt`, and `llms.txt` are present in `dist/` and well-formed; JSON-LD validates
- No console errors; layout holds at mobile width

**Scripts:** deliberately broken entry, duplicate URL, dangling alternative, and unregistered
category each rejected with a clear message; fuzzy-match warning observed firing.

**Actions:** `validate.yml` runs green on a real PR. The end-to-end issue-form test (real issue →
auto PR → validate passes) happens only **after checking in with the user**, per their instruction.

## Open item to report at the end

The exact DNS record for `sidequest.ibtisam-iq.com` (CNAME → `ibtisam-iq.github.io`, plus the
apex-vs-subdomain caveat), stated explicitly rather than assumed to be in place.
