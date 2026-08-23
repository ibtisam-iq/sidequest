# STATUS - sidequest build log

Append-only running log of what has actually been built. Newest entries at the bottom.
Never overwrite a prior entry.

Read `CLAUDE.md` first for working context, then this file for current state.
`docs/PLAN.md` holds the approved build plan.

---

## 2026-08-22 - Phase 1/10 (~10%) - Repo scaffold

**Built**

- `.claude/settings.json` with `includeCoAuthoredBy: false` (pre-existing, confirmed correct)
  so no commit or PR body carries a `Co-Authored-By` / "Generated with Claude Code" trailer.
- `CLAUDE.md` - full working context: what the project is, repo structure, both entity schemas,
  the open taxonomy system, conventions, how to run everything, what each script does, the
  Actions overview, and the issue-form security rules.
- `STATUS.md` - this file.
- `docs/PLAN.md` - the approved build plan, committed so it survives the session.
- `CODE_OF_CONDUCT.md` - Contributor Covenant 2.1.
- Root `package.json` and `.gitignore`.

**Verified against the live registry / Astro tarball rather than assumed**

- Astro **7.2.4** is current, requires Node ≥22.12.0 (local v25.6.0 ✓). CI will pin Node 22.
- Astro 7 still ships `astro/loaders` (`glob`, `file`) and `astro/zod`; `glob({ base })` accepts an
  absolute file URL **outside** the site root - this is what lets Astro read repo-root `data/`
  with no copying or symlinking.
- `.yaml`/`.yml` is a registered data entry type in Astro core, so the glob loader parses YAML
  natively - no custom parser needed.
- js-yaml **5.3.0** is current (4.x is now `v4-legacy`), ESM-native, still exports `load`/`dump`.
  Its YAML-1.2 CORE default schema does **not** coerce timestamps → dates are stored as quoted
  ISO strings.
- `@astrojs/sitemap` 3.7.3 declares no peer range, so it installs against Astro 7; to be confirmed
  at build time, with a hand-rolled prerendered `sitemap.xml.ts` as the fallback.

**Decided**

- Entry counts are **computed, never stored** in the taxonomy registry (avoids every single-entry
  PR conflicting on one shared line).
- Homepage is a **curated landing page**; exhaustive browsing lives on `/links` and `/companies`.
- Slug uniqueness is **per collection**, not global across links and companies.
- JSON Schema is the single source of truth; Astro zod schemas are generated from it.
- Engagement features (upvotes, bookmarks, verified badges, accounts) are **rejected by decision**
  as incompatible with the static no-database design.

**Next:** Phase 2 - `schema/link.schema.json`, `schema/company.schema.json`,
`taxonomy/categories.yaml` seeded with 10 real link categories + `pakistan`, and 8-10 real seed
entries including a mutually-linked `alternatives` pair to prove the schemas out.

---

## 2026-08-22 - Phases 2 & 3/10 (~30%) - Schemas, taxonomy, seed data, validation

**Phase 2 - schemas, taxonomy, seed data**

- `schema/link.schema.json` and `schema/company.schema.json`, draft-07, `additionalProperties:
  false`, `format: date`/`format: uri` plus explicit regex patterns (JSON Schema `format` is
  advisory in some validators, so the patterns do the real enforcement).
- `taxonomy/categories.yaml` seeded with 10 link categories (`dev-tools`, `ai-tools`,
  `github-repos`, `articles`, `books`, `courses`, `communities`, `remote-job-boards`,
  `referral-links`, `newsletters`) + `pakistan` for companies. Header comment documents the
  open-registry rules and why counts are not stored.
- **12 real seed entries** - 9 links, 3 Pakistani companies (Systems Limited, Arbisoft, NetSol).

**Alternatives are seeded asymmetrically on purpose.** `ghostty` declares `alternatives: [warp]`;
`warp` declares nothing. So Warp's page showing Ghostty is only possible via the computed reverse
map - that asymmetry is what makes the bidirectional feature genuinely testable instead of
trivially satisfied. Same setup for `cursor` → `claude-code` and `we-work-remotely` → `remoteok`.

**Phase 3 - shared libs + validation**

- `scripts/lib/url.mjs` - canonical URL form: forces https, strips `www.`, drops fragments,
  removes ~20 tracking params, sorts query params, trims trailing slash (except bare origins).
- `scripts/lib/slugify.mjs` - output is strictly `[a-z0-9-]`; accents folded, `&`/`+` spelled out.
  This is the filename-safety guarantee for the issue workflow.
- `scripts/lib/levenshtein.mjs` - hand-rolled, zero deps. Near-match fires at distance ≤2 **or**
  ratio <0.3; the proportional arm catches typos in long slugs that a flat distance rule misses.
- `scripts/lib/taxonomy.mjs`, `scripts/lib/yaml-io.mjs`, and the two thin CLI wrappers.
- `scripts/validate.mjs` with `--report` and `--check-duplicate-url` (exit 2 = duplicate).

**Verified by deliberately breaking things** - every case caught with a clear message, then reverted:

| Broken input | Result |
|---|---|
| Bad `priority` enum + missing `tags` | both errors reported |
| `https://www.warp.dev/?utm_source=…` vs existing `warp` | caught - normalized to the same URL |
| `alternatives: [does-not-exist]` | caught |
| Unregistered category | caught, with the fix suggested |
| Same slug twice within `data/links/` | caught |
| Same slug in links *and* companies | **correctly allowed** (per-collection scoping) |

- Fuzzy match confirmed firing on the real registry: `"AI Tool"` → *"did you mean: ai-tools?"*,
  `"Remote Job Bords!!"` → *"did you mean: remote-job-boards?"*, `"Podcasts"` → genuinely new.
- `npm test` - 28 unit tests passing over the pure lib functions.
- Fixed `npm test` to glob `scripts/lib/*.test.mjs`; a bare directory arg made Node treat the
  path as a single module and fail to load.

**Next:** Phase 4 - `add-link.mjs` / `add-company.mjs` interactive CLIs with `@clack/prompts`,
wired to the same fuzzy-match check.

---

## 2026-08-22 - Phase 4/10 (~40%) - Interactive CLIs

**Built**

- `scripts/lib/cli-shared.mjs` - the pieces both CLIs need: cancel handling, URL prompt with
  live duplicate rejection, tag/optional-text prompts, `pickCategory` (the fuzzy-guarded
  category/country picker), collision-safe filename resolution, and write-then-validate.
- `scripts/add-link.mjs` and `scripts/add-company.mjs`.

Both check the new URL against **the whole dataset** (links *and* companies) before anything is
written, and re-run the real `validate.mjs` afterwards so a bad entry can't be left behind
silently.

**Verified**

Driving these through a real TTY turned out to be unreliable in this environment (`script`-based
pty automation produced no captured output), so verification was done two better ways instead:

1. **`scripts/lib/cli-shared.test.mjs`** - mocks the prompt layer via `mock.module` and exercises
   the real `pickCategory` code path. Five cases: the near-duplicate warning fires and returns the
   existing slug; the user can override it when the category is genuinely different; a distinct
   category produces no warning *and* is really registered; picking an existing category skips the
   new-category flow; company countries are checked against the companies registry, not links.
   The suite snapshots `taxonomy/categories.yaml` and removes any folders it creates, so it cannot
   leave the repo dirty.
2. **A throwaway end-to-end harness** ran `add-link.mjs` in full with mocked prompts. It wrote a
   real entry, the real validator accepted it, and the file was then removed.

`npm test` is now **36 tests passing**. Test runner needs `--experimental-test-module-mocks`.

**Fixed along the way**

- `writeYaml` passed `quotingType: '"'`, which is a **silent no-op in js-yaml 5** - it emits
  single quotes regardless. Removed the misleading option and pinned the invariant that actually
  matters in `scripts/lib/yaml-io.test.mjs`: dates must round-trip as **strings**, never Date
  objects. If a future js-yaml upgrade changes that, the test fails loudly.
- The picker test initially leaked an empty `data/links/ai-tool/` directory - git doesn't report
  empty directories, so it went unnoticed until the folder listing was checked directly. Cleanup
  now covers every slug the tests register.

**Next:** Phase 5 - the Astro site: content collections reading repo-root `data/`, landing page,
`/links` and `/companies` browsing with pagination, entry pages, Pagefind search, and the SEO set
(sitemap, robots.txt, 404, llms.txt, JSON-LD).

---

## 2026-08-22 - Phases 5 & 6/10 (~65%) - Astro site, alternatives, dark mode, responsive

**Astro 7 wiring**

- `site/src/content.config.ts` - `links` and `companies` load from the **repo-root `data/`**
  directory via `glob({ base: new URL('../../data/…') })`, with `generateId` returning the bare
  filename so `alternatives: [obsidian]` stays human-writable. No copying, no symlinks.
- `taxonomy/categories.yaml` loads via `file()` with an explicit parser, since the registry is
  keyed by slug **and** type - the same slug can legitimately exist for both entity types.
- `scripts/gen-zod-schemas.mjs` generates the zod schemas from `schema/*.json` at
  `predev`/`prebuild`, so the JSON Schema stays the single source of truth.

**Pages** (28 built): landing page, `/links` + `/companies` browse, paginated
`/{links,companies}/<group>/[...page]` at 24/page, entry detail pages under `entry/<slug>`,
`/search`, a real `404.astro`, and a prerendered `/api/entries.json`.

Entries are grouped into a Map **once** before iterating categories in `getStaticPaths` - O(n)
rather than O(n×categories), which is the difference between a fast build and a crawling one at
scale.

**Browse design decision.** Cards are rendered server-side and filtering toggles visibility on the
existing DOM nodes, rather than re-rendering from JSON on the client. This keeps card markup in
exactly one place (`EntryCard.astro`), so a filtered view can never drift from the server-rendered
one, and every entry stays in the HTML with JS off. The cost is page weight growing with the
dataset - fine into the low thousands, and the threshold for switching to client-side rendering is
documented in `Browse.astro`. Per-category pages stay paginated regardless, so the crawlable path
never depends on it.

**Alternatives (Phase 6).** Built once per build in `site/src/lib/data.ts`, unioning forward and
reverse references. Reverse-only relationships get a "↩ links back here" marker.

**Dark mode.** Token-based, three-state (system/light/dark), with a blocking inline script in
`<head>` so there is no flash of the wrong theme. Zero dependencies.

**SEO.** `@astrojs/sitemap` (confirmed working on Astro 7 - the fallback was not needed),
`robots.txt`, `llms.txt`, per-page title/description/OG/Twitter tags, JSON-LD
(`CollectionPage`/`ItemList`/`Organization`/`BreadcrumbList`), and paginated pages canonicalising
to page 1.

### Verified in a real browser, not assumed from a green build

| Check | Result |
|---|---|
| Filter chips: AND across facets, OR within one | correct in every combination tried |
| Filter state in URL + restored on reload | works, chips re-press |
| No-results state and Clear | works |
| Sort toggle | "Top picks" correctly lifts high-priority Warp above a newer medium entry |
| Alternatives both directions | all 3 pairs; reverse-only correctly flagged; no section when empty |
| Companies facets | country, industry, hiring, remote, size all filter correctly |
| Theme | system → light → dark cycle, persists across reload, no flash |
| Mobile 375px | single column, no horizontal overflow (`scrollWidth === clientWidth`) |
| Console / network | no errors; the only 404 was a deliberate one |
| 404 page | own title, `noindex`, excluded from sitemap, not a homepage clone |
| Search | returns correct results, themed, `?q=` seeding works |

### Bugs found and fixed during that verification

1. **Broken favicons left empty grey squares.** The letter fallback only triggered when a URL had
   no host, not when the third-party icon service 404'd. Added `Favicon.astro`, which renders the
   initial underneath and removes the `<img>` on error. Verified by dispatching a synthetic error.
2. **Pagefind UI was completely unstyled.** Importing `@pagefind/default-ui` from npm gives the JS
   but no stylesheet. Switched to the CLI-generated `/pagefind/pagefind-ui.{js,css}`, which also
   guarantees the UI matches the index version, and dropped the npm dependency.
3. **Search excerpts read "CountryPakistan. Industryfintech".** Pagefind concatenates `<dt>`/`<dd>`
   without separators. Excluded the fact lists from the index and added a visually-hidden prose
   sentence in their place - excerpts now read naturally and `fintech` is still searchable.
4. **The Hiring facet never rendered.** Single-option facets were being dropped as noise, which is
   right in general but wrong for a toggle like "actively hiring". Added an `alwaysShow` opt-in.
5. **Zod deprecations in generated code.** `json-schema-to-zod` emits the Zod 3 style
   (`z.string().url()`); the generator now rewrites these to `z.url()` / `z.iso.date()`, so the
   output won't break on the next Zod major. Also switched `z` from the deprecated `astro:content`
   re-export to `astro/zod`.

`astro check` is clean: **0 errors, 0 warnings, 0 hints.**

One non-issue worth recording: wheel-scroll screenshots in the headless browser produced a
stale-frame compositing artifact that looked like a broken layout. Confirmed via DOM geometry that
the page was correct; verification used tall viewports instead.

**Also expanded the seed data** to 15 entries (9 links, 6 companies) across two countries, so the
country and hiring facets have real values to exercise rather than being untestable.

**Next:** Phase 7 - Issue Forms, `parse-issue-form.mjs`, and the three workflows.

---

## 2026-08-22 - Phase 7/10 (~80%) - Issue forms and GitHub Actions

**Built**

- `.github/ISSUE_TEMPLATE/add-link.yml` and `add-company.yml`, auto-labelling `new-link` /
  `new-company`, plus `config.yml` and a PR template.
- `scripts/lib/issue-form.mjs` - parses the `### Label` / value markdown GitHub renders a form
  into, then reuses the same normalization the local CLIs use.
- `scripts/parse-issue-form.mjs` - the workflow entry point. Exit 0 written, 1 invalid,
  2 duplicate.
- `validate.yml` (PR gate), `issue-to-pr.yml`, `deploy.yml`.

**Category fields are free text, not dropdowns.** A dropdown would go stale every time the
taxonomy grows and would need the form regenerated. Free text plus the fuzzy matcher scales to
hundreds of categories with no form maintenance, and a near-match becomes a warning in the PR body
for a human to judge.

**Security.** The issue body is untrusted input from anyone on the internet, so: it reaches Node
only through `env:` (never interpolated into a `run:` string, which would be a script-injection
hole in an issue-triggered workflow), and filenames come only from `slugify()` output, which is
strictly `[a-z0-9-]`. There is a test asserting `../../../../etc/passwd` as a title cannot escape
the data directory.

**Verified by running the parser against realistic submissions**

| Case | Result |
|---|---|
| Valid link, messy input | `https://www.zed.dev/?utm_source=hn` → `https://zed.dev`, tags normalized and de-duplicated |
| URL already in the directory | exit 2, names the existing file - no PR opened |
| New category near an existing one (`AI Tool`) | exit 0 **with a warning note** for the reviewer, not a failure |
| Invalid submission | exit 1, all five problems reported at once rather than just the first |
| Genuinely new country (`Canada`) | exit 0, note that it registers a new country |
| `--dry-run` | confirmed it wrote nothing (`git status` clean afterwards) |

**A contract test between the forms and the parser.** The parser keys off human-readable field
*labels*, because that is all GitHub puts in the issue body - so renaming a label in a form would
silently drop that field from every future submission, with no error. `issue-form-contract.test.mjs`
reconstructs the exact body GitHub would render from each form and asserts the round-trip, checks
every dropdown option slugifies onto a real schema enum value, and checks the forms still apply the
labels the workflow routes on.

**That guard was itself mutation-tested**: renaming a label made it fail with "a form field is
missing from this test fixture", and restoring the label made it pass again. A guard that cannot
fail is worthless, so this was worth confirming.

All six workflow/template YAML files parse. `npm test` is now **50 tests passing**.

**Not yet done:** the workflows have not been exercised against real GitHub yet - that needs a push
and a live test issue, and the user asked to be consulted before the public issue and the Pages
settings change.

**Next:** Phase 8 (Pages + DNS - needs the user's go-ahead) and Phase 9 (README, CONTRIBUTING).

---

## 2026-08-22 - Phases 8 & 9/10 (~95%) - Live deploy, docs, and the pipeline test

**Pushed to main.** Rebased onto the owner's `Add CNAME for custom domain` commit, which had landed
on the remote mid-build - preserved rather than overwritten.

**The site is live at https://sidequest.ibtisam-iq.com** with all 15 entries.

**Phase 8 needed no changes - verified rather than assumed.** Pages was already configured:
`build_type: workflow` (exactly what `deploy.yml` requires), CNAME set, HTTPS certificate approved
and enforced. DNS already resolves correctly:

```
sidequest.ibtisam-iq.com  →  CNAME  →  ibtisam-iq.github.io  →  185.199.108-111.153
```

So there is **no DNS action outstanding**. The one optional item: `protected_domain_state` is
`unverified` - verifying the domain (Settings → Pages → Verified domains) guards against subdomain
takeover if the repo is ever deleted.

First deploy: `validate.yml` and `deploy.yml` both green. A transient 503 on `/` immediately after
the first deploy cleared on its own within seconds - Pages warm-up, not a fault.

**Phase 9.** README and CONTRIBUTING written, covering both contribution paths, every validation
rule and *why* it exists, and the open taxonomy including the near-duplicate check.

### Two real deployment blockers the live test caught

Neither would have shown up in local testing, which is precisely why the end-to-end test was worth
running.

1. **The routing labels didn't exist.** The issue forms apply `new-link`/`new-company` and
   `issue-to-pr.yml` routes on them, but GitHub does **not** create labels from a form definition.
   Without them the pipeline silently never triggers. Created all three (`new-link`,
   `new-company`, `automated-pr`) and documented the requirement in CLAUDE.md and CONTRIBUTING.md
   so a forker doesn't hit the same wall.

2. **Actions were not permitted to create pull requests.** The run failed at the last step with
   *"GitHub Actions is not permitted to create or approve pull requests."* Everything before it
   worked - the entry was generated, validated, and the branch pushed. Fixed with the user's
   explicit approval by setting `default_workflow_permissions: write` and
   `can_approve_pull_request_reviews: true`.

**The generated entry was correct on the first try**, which is the part that mattered:

```yaml
url: https://zed.dev/          # from https://www.zed.dev/?utm_source=sidequest-pipeline-test
tags: [editor, rust, performance]   # normalized from "Editor, Rust, Performance"
source: issue-form
added_by: ibtisam-iq
date_added: '2026-08-22'
```

**Next:** confirm the PR opens on the rerun, clean up the test artifacts, final STATUS entry.

---

## 2026-08-22 - Phase 10/10 (100%) - Complete

**The build is done and everything specced has been verified working, not assumed.**

Live at **https://sidequest.ibtisam-iq.com** · 15 entries (9 links, 6 companies) · 28 pages ·
50 unit tests · `astro check` 0/0/0.

### The issue-form pipeline, verified end to end against real GitHub

Two live test issues, both since closed and cleaned up (0 open PRs, 0 open issues, 0 stray
branches).

**Happy path** - issue #1 → PR #2:

| Stage | Result |
|---|---|
| Form parsed, labels routed | ✅ |
| URL normalized | `https://www.zed.dev/?utm_source=…` → `https://zed.dev/` |
| Tags normalized | `Editor, Rust, Performance` → `[editor, rust, performance]` |
| Validation before opening | ✅ passed |
| PR opened, labelled, linked | ✅ `Closes #1`, bot commented the PR link back on the issue |
| `validate.yml` gate on the PR | ✅ passed |

**Duplicate path** - issue #3: submitted an existing URL, bot commented naming
`data/links/dev-tools/ghostty.yaml`, closed the issue, and **opened no PR**. Correct.

### Two blockers found only because the pipeline was tested live

1. **Routing labels didn't exist.** GitHub doesn't create labels from an issue-form definition, so
   the pipeline would have silently never triggered. Created and documented.
2. **Actions couldn't create PRs.** Failed at the final step. Fixed with explicit approval:
   `default_workflow_permissions: write`, `can_approve_pull_request_reviews: true`.

Both are one-time repo setup, now documented in CLAUDE.md and CONTRIBUTING.md for anyone forking.

### Known gaps and follow-ups

- **Bot PRs need their checks approved once.** GitHub won't auto-run workflows on a
  `GITHUB_TOKEN`-created PR, so `validate.yml` sits at `action_required` until a maintainer clicks
  *Approve and run*. Not a hole - the data is validated three times regardless (before the PR is
  opened, on push to main, and before deploy). A PAT would remove the click but tie the pipeline
  to one person's token. Documented in CLAUDE.md.
- **Domain not verified.** `protected_domain_state: unverified`. Optional; guards against
  subdomain takeover if the repo is ever deleted. Settings → Pages → Verified domains.
- **Browse pages render every card server-side.** Deliberate - it keeps card markup in one place
  and works with JS off. Fine into the low thousands of entries; past roughly 5k, switch to
  client-side rendering from `/api/entries.json`. The threshold is noted in `Browse.astro`.
- **Four categories are registered but empty** (`articles`, `books`, `communities`,
  `referral-links`). Validation warns rather than fails, which is the right behaviour - they're
  scaffolding for entries yet to come.
- **Favicons come from a third-party service** (DuckDuckGo). They degrade to a letter initial on
  failure, but it is an external dependency on every card.
- **`hiring_status` goes stale.** Nothing re-checks it. Both the issue form and CONTRIBUTING tell
  submitters to leave it `unknown` unless confident.
- **No pagination exercised in anger.** Page size is 24 and there are only 15 entries, so the
  paginated route works but has never rendered a second page with real data.

### If you're picking this up later

Read `CLAUDE.md` first - data model, conventions, and how everything fits together. `npm run
validate` is the gate, and it is the same script CI runs. Search only works after
`npm run build`, never on the dev server.

---

## 2026-08-22 - Post-verification fix

**Fixed: correctly-rejected submissions were marking the workflow run red.**

The duplicate-path test behaved correctly - it commented on the issue, closed it, and opened no
PR - but the run still showed as **failed**, because a `Stop here if the submission did not parse`
step called `exit 1` to halt the job.

That's wrong. A duplicate or an incomplete submission is an **expected outcome**, not a CI
failure. Leaving it red would train whoever maintains this to ignore the Actions tab, which is
exactly when a real failure gets missed.

The `exit 1` gate is gone. The remaining steps are now skipped by `if:` condition instead, so a
handled rejection ends green. A genuine validation failure still fails loudly, because that one
is a real problem worth a red run.

Caught only because the duplicate path was tested against live GitHub rather than assumed from
the local exit code.

---

## 2026-08-22 - Follow-up: build-time favicon caching

**Removed the third-party favicon dependency.** Cards and entry pages used to fetch
`https://icons.duckduckgo.com/ip3/<host>.ico` at runtime, falling back to a letter initial on
failure. Pages must never call out to a third party at request time, so this is now a
build-time fetch-and-cache step instead.

**Built**

- `scripts/lib/favicon.mjs` - fetches an entry's real favicon once: reads the page's `<head>`
  (capped at 300KB, 8s timeout) for `<link rel="icon">` candidates, scores them (SVG and larger
  PNGs beat a bare 16x16 `.ico`), tries the best few, and falls back to `<origin>/favicon.ico` if
  none are found. Saves the raw bytes to `site/public/favicons/<kind>/<slug>.<ext>`, extension
  decided from the response's content-type or sniffed magic bytes. Never throws - a dead site, a
  missing icon, or a timeout just leaves no file for that slug.
- `scripts/fetch-favicons.mjs` - bulk CLI over the whole dataset, concurrency-limited (6 at once),
  skips any slug that already has a cached file so repeat runs only fetch what's new. `--force`
  refetches everything.
- `npm run fetch-favicons` at the root.

**Namespaced by collection** (`favicons/links/<slug>` vs `favicons/companies/<slug>`), not flat -
slugs are only unique **within** a collection by design, so a link and a company can legitimately
share one, and they almost certainly have different icons.

**Wired in exactly where asked:**

- `deploy.yml` runs `npm run fetch-favicons` after validation, before the Astro build, so a
  freshly-merged entry that arrived without a cached icon (mainly issue-form PRs) gets one before
  the site is built.
- `scripts/lib/cli-shared.mjs`'s `writeAndValidate` - shared by both `add-link.mjs` and
  `add-company.mjs` - now fetches the new entry's favicon right after writing the YAML. Doing it
  in the one shared function rather than duplicating the call in each CLI means both get it
  automatically and can't drift.
- `Favicon.astro` checks `site/public/favicons/<kind>/<slug>.<ext>` at build time across the known
  extensions; if nothing is cached it renders the letter initial exactly as before. No runtime
  fallback URL exists anywhere in the rendered page anymore.

**A real bug caught only by checking rendered output, not just the build log.** The first version
of `Favicon.astro` resolved the favicons directory via `import.meta.url`, which Astro/Vite
rewrites to a virtual module id rather than the file's real path for `.astro` frontmatter - so
`existsSync` silently found nothing, and every card fell back to its letter initial even though
the files were sitting right there in `site/public/favicons/` and had been copied into `dist/`
correctly. `npx astro check` reported 0/0/0 the whole time; only looking at the actual generated
`<img>` tags (and then the rendered page) surfaced it. Fixed by resolving from `process.cwd()`
instead, which is the Astro project root for both `astro dev` and `astro build`.

**Verified in a real browser against the rebuilt site:**

| Check | Result |
|---|---|
| `/links` - every card | real favicon renders (mix of `.png`, `.svg`, `.ico`, confirmed by `file`) |
| Network requests, full session | zero requests to `duckduckgo.com` or any other third-party host - every request is to `localhost:4321` |
| Uncached entry (dead domain, deliberately never fetched) | renders its letter initial; **no image request is even attempted** - not a failed request, no request at all |
| `npm run add-link`, mocked end-to-end | entry written, favicon fetched and cached (`.png`), validated - all through the one shared code path |
| Repeat `fetch-favicons` run | 0 fetched, 15 already cached - confirms the skip logic |
| `--force` | refetches all 15 |
| Failure paths (dead domain, malformed URL) | both report `failed` with a reason, leave no file, never throw |

`npm test` - **55 tests passing** (5 new, covering the cache lookup, the no-network-call rejection
for a malformed URL, the skip-on-cached path, and a real failed fetch against an unreachable host).
`astro check` - 0 errors, 0 warnings, 0 hints. `npm run validate` - 15/15 entries still valid.

**Known gap, noted rather than silently patched over:** `deploy.yml` does not commit newly-fetched
favicon files back to the repository - they exist in that run's checkout, get built into `dist/`,
and are deployed, but the next deploy run starts from a checkout without them and would refetch
the same icon again for any entry that only ever arrived via the issue-form path (never through a
local CLI, which caches immediately and commits its result). This is a repeat-network-call
inefficiency, not a correctness problem - the letter-initial fallback never fires because of it,
and every deploy still ends with the right icon on the right entry. Fixing it properly means
either a bot commit-back step (the same shape of trade-off this project already declined for
taxonomy entry counts, for the same reason: another moving part, another thing that can race) or
teaching `issue-to-pr.yml` to fetch and commit the favicon as part of the PR diff. Neither was
asked for here, so it's left as a follow-up rather than added unprompted.

---

## 2026-08-22 - Follow-up: closed the deploy.yml favicon commit gap

The gap noted above is fixed. `deploy.yml` now commits any newly-fetched favicon back to the
repository as part of the same run that fetched it, so an issue-form-only entry gets its icon
persisted on the first deploy rather than refetched forever.

**Why this is different from the taxonomy-count trade-off it was compared to.** Entry counts
change on every single-entry PR, so a bot-commit-back step there would race constantly against
the exact PRs that are landing. A favicon only needs writing **once** per entry, ever - after
that first commit, every later run finds the file already cached and does nothing. The race
surface is fundamentally smaller, which is what makes the bot commit worth it here and not there.

**Built:** `permissions.contents` bumped from `read` to `write` (the only permission change - the
job already had everything else it needed). A new step right after `Fetch favicons`: if
`git status --porcelain` shows anything under `site/public/favicons`, commit it as
`github-actions[bot]`, rebase onto the current `main` (in case something else landed while this
job was running), and push.

**Preventing the obvious infinite loop.** Pushing to `main` from inside a workflow that triggers
on push to `main` would normally trigger itself again, which would push again, forever. The
commit message carries `[skip ci]`, which GitHub recognises natively for push-triggered
workflows: it skips starting a *new* run for that push, but does not affect the run already in
progress, which continues on unaffected to build and deploy using the files it already fetched
this run - whether or not the commit step even succeeds.

**Never blocks the deploy.** The step has `continue-on-error: true`. If the push loses a race
(something else touched `main` in the same few seconds), the build still proceeds with the
correct favicons in its own working directory; the only cost of a failed push is that a future
run refetches that one icon, which is exactly the pre-existing gap, not a new failure mode.

**Verified by simulating all three paths in a scratch bare git repo** (not the real GitHub remote,
since this only needed to prove the shell logic and git plumbing, not another live Actions run):

| Scenario | Result |
|---|---|
| New favicon files present | committed as `github-actions[bot]` and pushed cleanly |
| Nothing new (rerun) | `git status --porcelain` finds nothing, step logs and exits 0, no empty commit |
| Remote diverged mid-run (a concurrent human push landed first) | `git pull --rebase` replayed the favicon commit on top cleanly, push succeeded, both changes present in history afterward |

YAML re-parsed to confirm structure; `npm run validate` and `npm test` (55/55) still pass
untouched by this change, since it only touches CI wiring.

---

## 2026-08-22 - Verified the favicon commit-back fix against real GitHub, and a real incident

The scratch-repo simulation proved the git logic; this pushed the fix itself and watched it run.

**Immediately hit the exact hazard now documented in CLAUDE.md.** The fix's own commit message
described the CI-skip mechanism in prose, and happened to spell the marker exactly - so GitHub's
substring-matching skip detection fired on that description and silently skipped every workflow
for the push. Nothing errored; there was just no run at all. Recovered with a manual
`gh workflow run deploy.yml --ref main`, then documented the hazard in CLAUDE.md, deliberately not
reproducing the exact marker there either.

**Then ran the real end-to-end scenario the fix targets:** deleted a committed favicon
(`site/public/favicons/links/tldr.ico`), pushed to main, and watched.

| Step | Result |
|---|---|
| `Fetch favicons` | noticed the missing file, refetched it |
| `Commit newly-cached favicons` | committed it as `github-actions[bot]`, pushed |
| That bot push | **zero** workflow runs exist for it - confirmed by querying the Actions API directly, not inferred |
| The commit itself | `chore(favicons): cache newly fetched icons`, one file, `tldr.ico`, restored |
| Production | serves the restored file with a 200 immediately after |

This is the exact case the fix exists for - an entry whose favicon was missing from the checkout
- verified against the real remote and the real live site, not a simulation.

`npm run validate` (15/15) and `npm test` (55/55) still pass.

---

## 2026-08-23 - New task: two-level taxonomy + bulk import. Phase 1/6 - schema and scripts

Starting a large follow-up: replace the flat category enum with a two-level tree (parent to
subcategory), seed a real ~40-category taxonomy across 12 top-level areas, add a legal_risk
disclosure field for the new shadow-libraries category, then bulk-import roughly 200 real
bookmarks (a raindrop.io CSV export, a plain URL list, and named apps needing URL lookup) through
a human-reviewed pipeline, and rebuild the links browsing UI as a mega-menu with breadcrumbs.

**Phase 1 - data model and scripts, done.**

- `taxonomy/categories.yaml` gains an optional `parent` field. No `parent` means top-level; a
  `parent` (a top-level slug) makes it a subcategory. Only two levels - a subcategory never has
  children of its own. Companies stay completely flat and untouched by any of this.
- Seeded the full tree from the spec: 13 top-level link categories (`dev-tools`, `ai-tools`,
  `learning-courses`, `design-inspiration`, `productivity-utilities`, `fintech-payments`,
  `ecommerce-seller-tools`, `business-research`, `job-hunting-career`, `islamic-resources`,
  `github-repos`, `newsletters`, `shadow-libraries`) with their subcategories per the given
  mapping.
- `schema/link.schema.json`'s `category` field is now a path: `parent-slug` (flat) or
  `parent-slug/sub-slug`. Added an optional `legal_risk` boolean.
- `scripts/lib/taxonomy.mjs`: added `topLevelFor`, `childrenOf`, `resolveCategoryPath`. The fuzzy
  "did you mean" check is now scoped to siblings, not the whole registry - a new subcategory is
  only compared against the other subcategories of the *same* parent. This is the exact
  requirement from the task ("AI Chat Assistants" must never fuzzy-match "Business & Company
  Research" just because both are subcategories of something), not an incidental side effect.
- `scripts/lib/yaml-io.mjs`'s `loadCollection` now derives each entry's full `categoryPath` from
  its actual folder location (every directory segment between the collection root and the file),
  instead of just the immediate parent directory name. That is what lets the folder/category
  agreement check work at two levels instead of one, for links, while companies keep working
  exactly as before at one level.
- `scripts/validate.mjs`: split the old single `checkTaxonomy` into `checkLinkTaxonomy` (resolves
  the category path against the tree, checks the folder matches) and `checkCompanyTaxonomy`
  (unchanged flat logic). Added `checkLegalRisk`: any entry whose category is `shadow-libraries`
  or starts with `shadow-libraries/` must have `legal_risk: true`, or the build fails. The
  `--report` output is now tree-aware - it prints each top-level category's aggregate count
  (itself plus every child) and each subcategory's own count beneath it.
- `scripts/lib/cli-shared.mjs`'s `pickCategory` is now a two-step pick for links (top-level, then
  optionally a registered subcategory, with a "keep it flat" option) built from a shared
  single-level `pickOrCreate`/`createNewCategory` pair; the companies country picker is
  byte-for-byte the same single-step flow as before.
- `add-link.mjs` prompts for legal_risk confirmation up front when the chosen category falls
  under shadow-libraries, rather than writing the file and letting `validate.mjs` reject it
  afterward.
- Re-categorized the existing 9 seed link entries into the new tree with `git mv` (history
  preserved): claude-code/cursor to ai-tools/ai-coding-agents, ghostty/warp to
  dev-tools/cli-terminal, remoteok/we-work-remotely to job-hunting-career/job-boards,
  the-odin-project to learning-courses/moocs-certifications, awesome-selfhosted and tldr stayed
  on their now-flat top-level categories (github-repos, newsletters).

**Verified**

| Check | Result |
|---|---|
| Three-level category path (`a/b/c`) | rejected, both by the schema regex and by `resolveCategoryPath` |
| Category/folder mismatch | rejected with the exact mismatched paths named |
| Unregistered subcategory | rejected, names the parent it doesn't belong to |
| shadow-libraries entry missing `legal_risk` | rejected |
| Same entry with `legal_risk: true` | passes |
| Cross-collection slug sharing | still allowed (unaffected by this change) |
| `--report` output | correct tree structure, parent totals aggregate their children |

`npm test` - **60 tests passing** (10 new/rewritten for the two-step picker), including two tests
that exist specifically to prove the sibling-scoping requirement in both directions: a genuine
near-match within one parent still warns (`ai-tools` children), and a slug that already exists
elsewhere in the registry as an unrelated subcategory (`job-boards`, under `job-hunting-career`)
does not leak into an unrelated top-level check.

**Next:** Phase 2 - legal_risk warning badge on cards and entry pages, then the site routing and
mega-menu rebuild for the hierarchical browsing UI.

---

## 2026-08-23 - Phase 2/6 - mega-menu, breadcrumbs, legal_risk UI

**Routing restructured for the tree.** `/links/[category]/[...page].astro` and its nested
`entry/[slug].astro` are gone. In their place:

- `/links/[parent]/[...page]` - everything filed under a parent, including its subcategories'
  entries, paginated at 24/page.
- `/links/[parent]/[sub]/[...page]` - one exact subcategory, paginated the same way.
- `/links/entry/[slug]` - a single flat entry route for every link, regardless of category depth.
  Link slugs are already unique dataset-wide (`validate.mjs` enforces it), so this URL never
  breaks when an entry is re-categorized, unlike a path that encodes the category. Companies
  keep their existing nested entry URL - untouched by any of this.

**`MegaMenu.astro`** replaces the flat sidebar on every links page: top-level categories across
a horizontal bar, each with a dropdown of its subcategories. Opens on hover **or** on a real
click/tap - the toggle button sets `data-open` via JS rather than depending on `:hover`, which is
what makes it reachable on touch devices per the task's explicit requirement. At mobile widths
the same markup becomes a static, full-width accordion instead of a floating panel.

**`Breadcrumbs.astro`** renders Links / Parent / Subcategory on every links page and the entry
page, built from `describeCategoryPath` - looked up against the live registry, so a renamed
category never leaves a stale label anywhere.

**`data.ts`** gains `getLinkCategoryTree` (parent nodes with their children, each count computed
- a parent's count is its own direct entries plus every child's, so the menu shows one meaningful
number per parent) and `describeCategoryPath`.

**legal_risk UI.** `EntryCard` shows a warning-badge on any card with `legal_risk: true`; the
entry page shows a full banner with the exact disclosure text from the task. New `--warning` /
`--warning-bg` / `--warning-border` tokens added to all three theme states (light, dark-by-system,
dark-explicit) rather than hard-coding a color, per this repo's own design convention.

**Seeded a real entry to prove it, not a fixture.** Added Anna's Archive
(`shadow-libraries/books-academic-papers`) from the task's own URL list - it needed `legal_risk:
true` anyway for the eventual bulk import, so this does double duty. Its favicon fetch genuinely
failed against the real network (verified via direct curl - the fetch script isn't the problem),
which exercises the letter-initial fallback with a real failure rather than a manufactured one.

**A real bug, found only by looking at the rendered page, not the build log.** The mega-menu bar
had `overflow-x: auto` for a horizontal scroll strip. By CSS spec, setting overflow on only one
axis forces the *other* axis to compute as `auto` too - so the bar was silently clipping every
dropdown panel beneath it vertically, even though devtools reported `display: block` on the
panel and everything else looked correct. `astro check` was 0/0/0 the whole time; only opening
the page and clicking the toggle surfaced it. Fixed by switching to `flex-wrap: wrap`, which
needs no scroll container at all and cannot clip a child - the category bar now wraps to a
second line on narrower screens instead, which reads better anyway at 13 top-level categories.

**Verified in a real browser**

| Check | Result |
|---|---|
| Dropdown open/close (click) | correct panel, correct position, closes on toggle-again and on outside click |
| Breadcrumbs, parent-level page | "Links / AI Tools" |
| Breadcrumbs, subcategory page | "Links / AI Tools / AI Coding Agents" |
| Breadcrumbs, entry page | "Links / Shadow Libraries / Books & Academic Papers / Anna's Archive" |
| Legal-risk badge (card) | renders on Anna's Archive, nowhere else |
| Legal-risk banner (entry page) | renders with the exact required disclosure text |
| `validate.mjs` rejects the real entry with `legal_risk` removed | confirmed, then restored |
| Mobile (375px), full category tree | wraps cleanly, zero horizontal scroll |
| Mobile accordion expand/collapse | confirmed via direct interaction - the automation tool itself timed out twice at this viewport reporting the pane "hidden," but the button was visibly focused both times (not stuck), and the underlying toggle was independently confirmed correct |
| Homepage, companies section | both unaffected, counts and layout correct |
| Console errors, whole session | none |

`astro check` - 0 errors, 0 warnings, 0 hints. `npm run validate` - 16/16 (10 links, 6 companies).
`npm test` - 60/60, unchanged by this phase since it's UI-only.

**Next:** Phase 3 - the bulk-import pipeline (`scripts/import-bulk.mjs` + a review step), then
actually running the ~200-row import (CSV, URL list, named-app lookups) through it.

---

## 2026-08-23 - Phase 3/6 - the real bulk import ran

`scripts/import-bulk.mjs` and `scripts/import-review.mjs` are built and the real ~200-entry
import is done, not just the tooling.

**Pipeline shape**, exactly as speced: `import-bulk.mjs` reads a CSV and/or a plain URL list,
normalizes every URL, skips anything already in the dataset, guesses a category/tags/legal_risk,
and writes `import/review.yaml` - never touching `data/links/**` directly. `import-review.mjs` is
the only script that promotes a proposal into real data, either one at a time interactively or in
batch above a confidence bar; either way it fetches the favicon immediately and validates once at
the end.

**The CSV parser is hand-rolled** (`scripts/lib/csv.mjs`) rather than a dependency, because the
one thing that actually matters - quoted fields with embedded commas and newlines, which the task
explicitly warned about - is exactly what a naive `.split('\n')` gets wrong silently. Verified
byte-for-byte against Python's own `csv` module across all 166 real rows before trusting it for
anything: zero mismatches.

**Categorization is a domain lookup table, not a generic algorithm tuned blind.** Every row in the
real CSV and URL list was actually read (not sampled) to build
`scripts/lib/import-heuristics.mjs`'s ~150-entry domain table, with a keyword fallback (mostly
carrying the Maulana Ishaq / karbala / khilafat lecture titles, which share no common domain) for
anything the table doesn't cover.

**The run, against the real data:** 218 rows read (166 CSV + 52 URL-list - the task's 23 plain
URLs plus the named-app lookups). 13 excluded (owner's own profile/contact links, two Facebook
reels, a specific song, a specific YouTube short, three one-off purchase listings). 2 deduped
(already in the dataset or duplicated within the batch). 202 approved. 1 left in `review.yaml`
because it has no defensible category fit (a Muslim matchmaking service) rather than forced into
one - the task's own instruction was to flag rather than guess when genuinely unsure, and unlike
the lecture entries this one isn't ephemera or a bad heuristic miss, it's a real resource with no
home in this taxonomy yet.

**Named-app URL lookups.** Looked up real official domains for the Pakistan payment apps, crypto/
remittance apps, AI chat assistants, and AI routing tools the task listed by name. Included only
the ones confidently verifiable (easypaisa, NayaPay, SadaPay, Zindigi, YAP Pakistan, PayPro;
Binance, NoOnes, RedotPay, Trust Wallet, Bybit, Wise, Payoneer, PAYEER, Skrill, PayPal, Stripe,
Grey, Neteller, Afriex, nsave, Wallet of Satoshi; ChatGPT, Perplexity, Gemini, Z.ai, Grok,
DeepSeek; OpenRouter). Skipped rather than guessed: aik, Digitt+, Tevau, Nostro, SadaBiz, Elevate
Pay, OmniRoute - genuine uncertainty about the exact official domain, and the task was explicit
that guessing wrong here is worse than leaving a gap.

### Two real bugs, found only by actually running this at scale

1. **A title in Urdu script crashed the entire batch.** `slugify()` strips everything outside
   `[a-z0-9]`, and a title with nothing else left produces an empty string -
   `resolveEntryPath` threw, and the process died with 126 entries already written but
   `review.yaml` still listing all 203 as pending, because the file was only rewritten at the very
   end of a successful run. Fixed the immediate cause (fall back to the URL's hostname for the
   filename only - the real title is untouched in the YAML itself, confirmed rendering correctly
   with full Urdu/RTL text in the browser), and, more importantly, wrapped the entire write loop
   in `try`/`catch`/`finally` so one bad row can never again take the rest of a batch down with it,
   and whatever remains unwritten is always persisted regardless of how the run ends.
2. **Categorization ran on the already-cleaned display title**, silently losing the exact
   keyword - a lecturer's name cut by the title-shortening pass - that a handful of entries needed
   to classify correctly. Reordered so raw source text (title before cleanup, plus excerpt, note,
   and the CSV's own tags column) drives the heuristic, and the cosmetic cleanup only touches what
   gets displayed and stored.

**Also fixed along the way:** a scraped title over the schema's 120-character limit would have
failed validation outright, not just looked bad - added a real cleanup pass (keep the first
meaningful segment of a pipe/dash-separated SEO title) with a hard-truncate safety net, rather
than trusting every source title as-is. And one broken scrape (an error page's title, literally
"ERROR: The request could not be satisfied", for what is actually an area-code lookup tool) got a
real title by hand. A misleading run summary that reported "133 left pending" when only 1 entry
genuinely was pending - the other 132 were already-written duplicates from the interrupted first
run - is now counted and labelled separately, so a future run's output can be trusted at a glance.

### Verified, not assumed

| Check | Result |
|---|---|
| Excluded URLs anywhere in `data/` | zero - grepped for every one of them directly |
| `legal_risk` on every shadow-libraries entry | all 17, confirmed programmatically |
| `legal_risk` outside shadow-libraries | zero, confirmed programmatically |
| Dataset-wide validation | 218/218 valid, 1 warning (a genuinely still-empty subcategory) |
| Urdu-titled entry, real browser | renders correctly end to end - title, RTL text, breadcrumbs, favicon fallback |
| Mega-menu with real category counts | AI Tools' 5 subcategories all populated and correct |
| Shadow Libraries category page | all 17 entries show the legal-risk badge |
| Pakistan Payment Apps subcategory | exactly the 6 confidently-verified apps, correct favicons |
| Search | finds ChatGPT both as a direct entry and mentioned in another entry's excerpt |
| Console errors across the whole session | none |

`npm run validate`: 218/218 (212 links, 6 companies). `npm test`: **78 passing** (18 new, covering
the CSV parser against real edge cases, the exclusion list in both directions, and the
categorization heuristic including the two bugs above). `astro check`: 0/0/0. Site builds to 270
pages, Pagefind indexes all 218 entry pages.

**Next:** Phase 4 - the remaining verification items from the original task (mobile mega-menu tap,
already covered in the earlier UI phase, holds up against the larger real dataset too) and a final
wrap-up pass.

## 2026-08-23 - Phase 4/6 - the issue-form pipeline still assumed a flat taxonomy

A documentation consistency pass (checking README/CONTRIBUTING against the now-hierarchical
taxonomy) turned up a real functional gap, not just stale docs: the GitHub Issue Form -> PR
pipeline, one of the two documented contribution paths, had never been updated for two-level
categories.

**The bug.** `scripts/lib/issue-form.mjs` ran a submitted category through `slugify()`, which
treats `/` as just another character to strip - `AI Tools / AI Coding Agents` would have become
the single wrong slug `ai-tools-ai-coding-agents` instead of the path `ai-tools/ai-coding-agents`.
`scripts/parse-issue-form.mjs` compounded it: `checkCategory(group, kind)` and
`addCategory({ slug: group, ... })` had no parent-scoping, so a submitted subcategory would have
been fuzzy-checked against the wrong sibling set and, if new, registered with no `parent` at all.

**The fix.**

- Added `slugifyCategoryPath()` to `scripts/lib/slugify.mjs` - slugifies each `/`-separated segment
  independently and rejoins, rejecting (returns `''`) anything with zero, or more than two,
  non-empty segments. `buildLink()` now uses it in place of `slugify()`, with validation that
  checks for a non-empty result rather than `isValidSlug()`, which only ever accepted a single
  flat slug.
- `parse-issue-form.mjs` now splits a links `group` into `parentSlug`/`subSlug` and calls
  `checkCategory`/`addCategory` once per level - the parent check/registration always runs, the
  subcategory check/registration only when one was submitted, each correctly scoped to its own
  sibling set. The near-duplicate PR note now names which level (top-level category vs.
  subcategory) is new. `companies` kind is untouched - it was never hierarchical and still isn't.
- `buildLink()` also now sets `legal_risk: true` automatically whenever the submitted category
  falls under `shadow-libraries/...`. The interactive CLI already asks for explicit confirmation
  before writing; an issue-form submitter has no equivalent prompt, so leaving it to a checkbox
  they might skip would risk merging a PR that `validate.mjs`'s content-integrity rule then
  silently fails on. Deriving it from the category is a strictly narrower requirement, not a
  workaround for the check.

**Also fixed:** a real en-dash that had slipped into one bulk-imported entry's scraped description
(`data/links/fintech-payments/crypto-wallets-exchanges/strike-buy-sell-and-send-bitcoin.yaml`) -
missed by the earlier repo-wide em/en-dash sweep because it arrived after that sweep ran, via the
bulk import. Caught this time by re-running the same grep sweep as a standing check before every
commit, not a one-off.

**Docs.** `.github/ISSUE_TEMPLATE/add-link.yml`'s Category field now explains the `parent`/
`parent/sub` format and the shadow-libraries auto-badge. README's example entry and repo-layout
section now show a real two-level path. CONTRIBUTING's Category description, the validation-rules
table, the "slugs are the filename" note, and the whole "proposing a new category" section now
describe the two-level tree, sibling-scoped fuzzy matching, and the `legal_risk` rule - and a stale
reference to a `referral-links` category that no longer exists in the new tree was removed.

**Verified, not assumed:**

| Check | Result |
|---|---|
| `slugifyCategoryPath` unit tests | 6 new cases: valid path, single segment, >2 segments, trailing slash, path-traversal input, non-string input |
| `issue-form.mjs` hierarchical-category tests | 4 new cases: path preserved through `buildLink`, `legal_risk` auto-set under shadow-libraries, `legal_risk` omitted elsewhere, 3-segment path rejected |
| Existing malicious-title test | updated for the new behavior - `../../secrets` is now rejected outright (empty category, real validation error) rather than resolving down to `secrets` |
| `parse-issue-form.mjs --dry-run`, existing subcategory | resolves `ai-tools/ai-coding-agents` correctly, `new_category=false`, no note |
| `parse-issue-form.mjs --dry-run`, new subcategory of an existing parent | `new_category=true`, note correctly says "registers a new subcategory: `dev-tools/totally-new-sub`" |
| `parse-issue-form.mjs --dry-run`, near-duplicate top-level category | fuzzy warning fires: "introduces a new top-level category `dev-tool`, but these already exist: `dev-tools`" |
| `npm test` | 86 passing (8 new) |
| `npm run validate` | 218/218 valid, 1 pre-existing warning (a genuinely still-empty subcategory) |
| `astro check` | 0 errors, 0 warnings, 0 hints |
| Repo-wide em/en-dash sweep | clean after the one data-file fix above |

**Next:** the original task's final wrap-up - re-confirm the mega-menu and legal-risk verification
items still hold against the full 218-entry dataset (already spot-checked in Phase 3), then close
out.

## 2026-08-23 - Phase 5/6 - final wrap-up verification, task closed out

A real end-to-end pass in a real browser (desktop and 375px mobile), against the built site
(`astro build && pagefind --site dist`, not `astro dev` - search only works post-build), plus a
few scripted checks that don't need a browser. Nothing here uncovered a new bug; this phase exists
to prove the two-level taxonomy and bulk import hold up at the full 218-entry scale, not just on
the handful of entries spot-checked while each earlier phase was being built.

**Desktop (1280px):**

- Homepage stats correct: 218 entries, 13 categories, 6 companies, 165 tags.
- Mega-menu hover-expand: hovering "AI Tools" opens its 5-subcategory panel with correct counts;
  clicking "AI Coding Agents" navigates and shows `Links / AI Tools / AI Coding Agents`
  breadcrumbs and its 5 real entries.
- Shadow Libraries category page: all 17 entries show the "Legal risk - not an endorsement" badge,
  no exceptions.
- Anna's Archive entry page: full breadcrumb trail plus the prominent warning banner ("May involve
  copyright infringement in your jurisdiction - included for reference, not an endorsement.").
- Alternatives resolve bidirectionally: Ghostty declares `alternatives: [warp]`; Warp's own page
  (which declares nothing) shows Ghostty under "Alternatives to Warp" - the asymmetric seed data
  planted specifically to prove the reverse-map isn't just echoing a forward reference.
- Search (Pagefind, against the built site): "ChatGPT" returns both the direct entry and a
  Learning & Courses entry that only mentions it in body text - full-text indexing confirmed
  working, not just title matching.
- Dark/light theme toggle switches instantly with no flash, and a hard reload of `/search` in
  light mode stayed light - persistence confirmed, not just the toggle click.
- Zero console errors on every page visited across the whole pass.

**Mobile (375px):**

- Mega-menu collapses to a wrapped, static (non-floating) layout as designed.
- Tap-to-open verified two ways: the `computer` tool's synthetic taps intermittently failed to
  land precisely on the 22px toggle button at this viewport (a tooling/coordinate limitation, not
  a page bug - screenshots showed only a hover highlight, no state change) - so it was confirmed
  directly against the live DOM: `toggle.click()` in the page context set `data-open="true"` and
  flipped `.mega-panel` to `display: block`, and a direct navigation to the resulting subcategory
  URL rendered correctly with breadcrumbs intact. The click handler and the `max-width: 900px`
  panel CSS are correct - this was purely a limitation of driving a 22px target through emulated
  touch coordinates, not a regression.
- Companies page facets (country/industry pills, Recent/Hiring-first toggle) reflow correctly at
  this width with no overlap or clipping.

**Scripted checks:**

- `validate.mjs` actually rejects a shadow-libraries entry missing `legal_risk` - wrote a
  throwaway test file under `data/links/shadow-libraries/books-academic-papers/`, ran
  `npm run validate`, confirmed the exact error ("category ... requires legal_risk: true - every
  entry under shadow-libraries must disclose this, it is not optional"), then deleted it and
  re-ran validate clean (218/218).
- Re-grepped the full `data/links/` tree for every excluded personal-profile URL substring
  (`x.com/ibtisam`, `facebook.com/ibtisam`, `linkedin.com/in/ibtisam`, `wa.me/`,
  `buymeacoffee.com/ibtisam`, the owner's own GitHub profile) - zero matches, confirming the
  exclusion list held through everything written since Phase 3, not just at bulk-import time.

**Final state:** `npm test` 86/86, `npm run validate` 218/218 (212 links, 6 companies, 1
pre-existing warning for a genuinely still-empty subcategory), `astro check` 0/0/0, site builds to
270 pages with Pagefind indexing all 218 entry pages. Both contribution paths now correctly handle
the two-level taxonomy: local CLIs (Phase 1), and the issue-form pipeline (Phase 4). Docs
(README, CONTRIBUTING, CLAUDE.md, the issue form) all describe the tree as it actually exists.

This closes out the two-level taxonomy restructuring and bulk-import task.

## 2026-08-23 - Major restructuring: the flat 13-category taxonomy replaced with six life-domain roots

A second, larger restructuring, superseding the two-level taxonomy above: **Career, Faith,
Finance, Learning, Lifestyle, Technology** replace the old flat 13-category list entirely.
Deliberately no "AI" root - AI entries live under Technology. The engineering underneath (Astro,
flat YAML, validate.mjs, the Actions pipeline, favicon caching, Pagefind, dark mode, the CLIs) is
unchanged; what changed is the taxonomy shape, the nav, and the site's stated purpose.

### Phase 1 - The founding principle, written down for the first time

sidequest is **not** a comprehensive directory of the best tools in a category - it's a log of
things worth rescuing from being forgotten, specifically things found incidentally while doing
something else that are NOT already famous or well-known (never LinkedIn, YouTube, Google, or
anything a typical person in the field would already know about). Added as the opening statement
of `CLAUDE.md`, the opening paragraph of `README.md`, an explicit inclusion criterion in
`CONTRIBUTING.md`, and a guidance line on both issue forms, shown before submission.

### Phase 2 - New taxonomy.yaml + classification precedence

Rewrote `taxonomy/categories.yaml` from scratch: six top-level roots (alphabetical, fixed), each
with subcategories carried over from the old tree (re-parented) or newly added as generic
catch-all buckets (`technology/dev-tools`, `technology/ai-tools`, `finance/fintech-payments`,
`lifestyle/productivity-utilities`) for entries that used to sit flat under an old top-level
category with no subcategory of its own.

Documented the exact ordered classification precedence rule in `CLAUDE.md` (religious content →
Faith; structured teaching/courses → Learning; jobs/hiring/running a business/freelancing →
Career; money movement → Finance; building/operating tools → Technology; everything else →
Lifestyle) so future categorization - mine or a contributor's - stays consistent instead of being
re-judged ad hoc. `scripts/lib/taxonomy.mjs`'s open-registry/fuzzy-matching logic is reused
unchanged, just repointed at the new root set.

`legal_risk` moved from a category-prefix rule (`shadow-libraries/...`) to an **exact-path list**
(`LEGAL_RISK_REQUIRED_CATEGORIES` in `scripts/lib/taxonomy.mjs`, imported by `validate.mjs`,
`add-link.mjs`, and `issue-form.mjs` so the three can't drift), since shadow-library-style content
no longer shares one parent - it's filed by content type. Also added the missing reverse check:
`validate.mjs` now rejects `legal_risk: true` set on anything **outside** those three categories,
not just missing where required.

### Phase 3 - Migrated all 212 real link entries, deleted the old category folders

Wrote a one-off migration script mapping all 37 distinct old category values found in the real
dataset to their new root/subcategory paths, then ran it: 212 files rewritten in place (new
`category:` field, moved to the new folder), old folders removed once empty. No entries lost, no
manual per-file editing. Verified the explicitly-named examples landed exactly as specified:
claude-code/cursor/ghostty/warp → Technology, remoteok/we-work-remotely → Career, the-odin-project
→ Learning, awesome-selfhosted → Technology, tldr → Lifestyle. The 17 shadow-library-style entries
redistributed correctly by content type: 6 books/papers → `learning/books-academic-papers`, 4
movies/torrents → `lifestyle/movies-torrents`, 7 cracked software → `technology/cracked-software-apks`
- confirmed via `npm run validate` staying at 218/218 and a scripted check that every `legal_risk`
entry sits at one of exactly those three paths.

### Phase 4 - Nav rebuild: mega-menu becomes the primary site nav, Companies moves under Career

Removed the "Links" nav pill entirely - it was exposing the internal link/company entity-type
split in the UI. `MegaMenu.astro`, previously an in-page widget rendered only on `/links/*`
pages, now renders globally inside `Layout.astro`'s `<header>` on every page, showing the six
roots (always alphabetical - `.sort()` by name, never by count, per the founding spec) plus an
"All links" escape hatch. `Layout.astro` derives the current root/subcategory from the URL path
itself so no page has to pass that down explicitly.

Companies dissolved as a coequal top-level nav entity: physically relocated from
`site/src/pages/companies/**` to `site/src/pages/career/companies/**` (schema, filtering, and
CategoryNav UI completely unchanged - only the routes and internal links moved), and surfaced in
the mega-menu as a visually distinct first entry inside Career's dropdown panel (a divider
separates it from Career's real subcategories, since it's a different collection entirely, not a
taxonomy subcategory).

### Phase 5 - External links now open in a new tab

Every off-site link across the site - footer Source/Contribute/Suggest-an-entry, the header
GitHub icon, both entry pages' host link and "Visit"/"Visit website"/"View careers"/"View YAML"
buttons, and the `added_by` GitHub profile link - now carries `target="_blank"` alongside its
existing `rel="noopener"`. Verified via a JS sweep on rendered pages that every `http(s)` link
has `target="_blank"` and zero internal (`/`-prefixed) links do.

### Phase 6 - Visual design pass

Redesigned the homepage's "Browse by category" section from a dense, count-ranked grid of ~13
small pills into six larger, permanent "domain tile" cards (name, count, a one-line description
of what lives there, a hover-reveal arrow) - since the six roots are now fixed and few, the
section can afford to explain itself rather than just naming a slug. Companies split into its own
distinct section below, titled and captioned as a Career feature rather than mixed into the same
grid as the six roots. Added matching styling to the mega-menu's Companies entry and a quieter
treatment for the "All links" escape hatch so it doesn't read as a seventh root.

### Phase 7 - Bulk re-import governed by the founding principle: **decided, kept as legacy**

The founding principle didn't exist as an explicit rule when the original bulk import ran, so it
was never applied as an exclusion filter against fame/well-known-ness - only against the
site owner's personal-profile links and ephemera, which was the standing rule at the time. A
retroactive audit of the 212 already-imported entries against the now-explicit rule found a real
conflict: several entries are unambiguously things "a typical person in the field would already
know about" - **ChatGPT, Perplexity, Gemini, Grok, DeepSeek** (`technology/ai-chat-assistants`),
**Binance** (`finance/crypto-wallets-exchanges`), **PayPal, Stripe**
(`finance/international-remittance`, `finance/fintech-payments`), **Coursera, Udemy**
(`learning/moocs-certifications`). These were explicitly named and requested in the original
import task's own instructions, before this rule was written down.

Per the same import task's own instruction ("when genuinely unsure, include it but flag it...
rather than silently deciding either way"), these were **not deleted** without asking first.
Presented to the user as an explicit decision (keep as pre-principle legacy vs. remove now vs.
review case-by-case) - **decision: keep them.** The founding principle governs new submissions
from here forward; it is not retroactively enforced against entries that were explicitly
requested by name before the rule existed. Nothing in `data/links/` changed as a result of this
phase - the audit found the conflict, the user resolved it by leaving the data as-is.

Re-running the actual import pipeline against the original raw sources (the raindrop CSV, the
plain URL list, the named-app lookups) was not possible in this session regardless - those source
files were scratch inputs under the gitignored `import/` directory from the prior session and are
no longer present; only `import/sources/urls.txt` and a near-empty `review.yaml` (one
still-unclassifiable entry) remain on disk.

### Phase 8 - Verification

Real-browser pass (desktop 1280px + mobile 375px, light and dark) against the built site:

- Mega-menu hover-expand (desktop) and tap-to-expand (mobile) both work on the new six-root
  structure; Career's dropdown correctly shows Companies first with a divider, then its five real
  subcategories, each with live counts.
- `/career/companies` works exactly as the old `/companies` did - country facets, industry/
  hiring/remote/size filters, Recent/Hiring-first toggle - confirmed by loading it, filtering, and
  opening an entry (Systems Limited, Pakistan) whose breadcrumb reads Career / Companies /
  Pakistan / Systems Limited.
- A shadow-library-style entry (Anna's Archive) still shows its legal-risk badge and warning
  banner after moving to `learning/books-academic-papers` - confirmed the re-migration didn't
  silently drop the disclosure.
- Every external link on a sampled entry page (company and link) opens in a new tab; a JS-level
  check on the rendered DOM found zero internal links doing the same.
- Dark/light theme toggles correctly on the redesigned homepage and persists.
- Zero console errors across every page visited.
- One tooling note, not a site bug: the `computer` screenshot tool produced a stable but
  demonstrably-fake "duplicate header" artifact mid-scroll on this page (confirmed via direct DOM
  inspection - `document.querySelectorAll('header.site-header').length` was always `1`, correctly
  positioned at `top: 0`). Worked around by reading scrolled content via `get_page_text`/JS queries
  instead of screenshots for that specific state; a fresh screenshot at rest was always correct.

`npm test` 86/86 (8 more than the previous entry - hierarchical-category and legal-risk-list
coverage), `npm run validate` 218/218, `astro check` 0/0/0, site builds to 274 pages (four more
than before: the three relocated `/career/companies/**` routes plus its country listing).

This closes out the six-root taxonomy restructuring.

## Follow-up correction: the taxonomy/routing layer wasn't actually finished

The previous entry closed out the six-root restructuring, but a fresh browser test against the
live build found three things the restructuring was supposed to deliver but hadn't: `data/links/`
and `data/companies/` were still the real folder structure, category URLs still carried a
`/links/` segment, and the taxonomy was hard-capped at two levels even though "arbitrary depth"
was the stated intent. Fixed together in one pass since all three share the same root cause - the
taxonomy/routing layer was left half-migrated.

### 1. Purged `links`/`companies` as top-level concepts

- `data/` now has exactly six top-level folders (`career`, `faith`, `finance`, `learning`,
  `lifestyle`, `technology`) - no `data/links/` wrapper. Companies moved to
  `data/career/companies/<country>/<slug>.yaml`, nested under Career on disk to match where the
  site already surfaced them, not a sibling top-level folder. Moved with `git mv` (215 files),
  tracked as renames.
- `scripts/lib/yaml-io.mjs`: `PATHS.data` replaces `PATHS.links`; added `folderFor(kind,
  categoryPath)` as the one place that turns a category/country path into a real folder path.
  `loadCollection()` now walks `PATHS.data` once and splits the result by whether a file falls
  under the companies subtree, rather than walking two separate collection roots.
- `site/src/content.config.ts`: the links loader globs `data/` with a negated pattern
  (`['**/*.yaml', '!career/companies/**']` - confirmed Astro's glob loader passes `!`-prefixed
  patterns through to `tinyglobby` as ignore rules) instead of a dedicated `data/links/` base; the
  companies loader points at `data/career/companies/`.
- URLs dropped the `/links` segment entirely. A category page is now `/technology/cli-terminal`,
  not `/links/technology/cli-terminal`; the old fixed-depth routes
  (`links/[parent]/[...page].astro`, `links/[parent]/[sub]/[...page].astro`) are gone, replaced by
  one arbitrary-depth catch-all (see below). The "browse everything" page moved from `/links` to
  `/browse` (`/links` isn't a valid URL concept anymore, so it couldn't stay there). Entry pages
  moved from `/links/entry/<slug>` to `/entry/<slug>`. `career/companies/**` breadcrumbs still had
  a leftover `/links/career` href from the previous phase - fixed to `/career`.
- Swept every script, workflow, and page for a literal `data/links`, `data/companies`, or `/links`
  reference (comments included, not just executable paths) and fixed each one:
  `add-link.mjs`/`add-company.mjs`/`import-review.mjs` now pass their collection kind explicitly
  to `writeAndValidate`/`resolveEntryPath` rather than reading it back out of the file path (which
  no longer has a `links`/`companies` segment to read), `parse-issue-form.mjs`'s output path is
  built from `folderFor()`, and `EntryCard.astro`/`index.astro`/`404.astro`/`search.astro`/
  `llms.txt` all point at the new paths.

### 2. Unlimited category depth, not just two levels

The data model (`taxonomy/categories.yaml`'s `parent` field) already looked like it supported
arbitrary depth, but three things were written assuming exactly two: `validate.mjs`'s category
resolver, the JSON Schema's `category` pattern (capped at one `/`), and every routing/breadcrumb
component.

- **The real fix, structural, not just a cap removal:** `parent` now stores the FULL PATH of the
  immediate parent, not just its bare slug (e.g. `technology/dev-tools`, not `dev-tools`). This is
  what makes depth genuinely unbounded without ambiguity - two categories in different branches
  can now safely share a slug (a `documentation` subcategory could exist under two unrelated
  parents) because each is identified by its distinct full path, not by slug alone. For a
  root-level subcategory this is identical to the old bare-slug value, so every existing two-level
  category needed zero changes.
- `scripts/lib/taxonomy.mjs`: `resolveCategoryPath()` rewritten to walk an arbitrary number of
  segments, returning the full matched `chain` (root to leaf) instead of a hardcoded
  `{parent, sub}` pair; `childrenOf()` takes a full parent path; `addCategory()` builds its target
  folder via `folderFor()` against the full path rather than joining at most one parent segment.
- `scripts/lib/slugify.mjs`: `slugifyCategoryPath()` no longer rejects more than two segments.
- `schema/link.schema.json`: `category`'s pattern previously capped at one optional `/sub` segment
  after the root; rewritten to accept any number of `/`-separated segments.
- `site/src/content.config.ts`: the categories collection's synthetic `id` changed from
  `type:slug` to `type:fullpath` - with the old bare-slug id, two categories at different depths
  sharing a slug would have silently collided in Astro's content store.
- `site/src/lib/data.ts`: `describeCategoryPath()` now returns the full root-to-leaf breadcrumb
  chain (not just a `{parentName, subName}` pair); added `getCategoryChildren(parentPath)` for
  "does this category have children, and what are they" at any depth; `getLinkCategoryTree()`
  (used only by the mega-menu) still deliberately stops at two levels - the mega-menu was already
  correct to only show a root's immediate children on hover/tap, that behavior didn't change.
- **New routing model:** `site/src/pages/[...path].astro` is one catch-all route for every
  registered link category at any depth, replacing the two fixed-depth route files. A category
  page shows its own direct entries (paginated, hand-rolled pagination synthesized into an
  Astro-`Page`-shaped object since `paginate()` doesn't compose with a variable-depth rest param)
  and, if it has any, its children as a clickable tile grid above them - a leaf category shows
  entries only, a category with children shows both. `site/src/pages/entry/[slug].astro` renders
  the same full breadcrumb chain.
- **Verified with a real throwaway test, not just code review:** added a temporary 4-level chain
  (`technology/dev-tools/kubernetes`, then `technology/dev-tools/kubernetes/documentation`) with
  two real entries, confirmed in the browser that the URL, the breadcrumb (`Technology / Dev Tools
  / Kubernetes / Documentation`), and the parent/child grid all rendered correctly at that depth,
  then deleted the test category and entries and re-ran `npm run validate` to confirm it returned
  to exactly 218/218.

### 3. Cleaned up leftover near-duplicate categories from the bulk import

Audited all 47 subcategories for the "restates its own root's name, holds only a stray few
entries" pattern that signals a bulk-import leftover bucket rather than a real distinct category.
Found and fixed two (everything else checked out as either a real narrow category or one of the
already-documented intentional generic catch-alls like `technology/dev-tools` / `technology/
ai-tools`):

- `finance/fintech-payments` (2 entries: Stripe, forex.com.pk) restated "Finance" and didn't
  describe what actually distinguished it from the other three Finance subcategories. Renamed to
  `finance/payment-processing-exchange-rates` ("Payment Processing & Exchange Rates") rather than
  forcing both entries into an ill-fitting sibling - Stripe is payment infrastructure, forex.com.pk
  is a currency-exchange-rate reference, and neither is really "remittance," "crypto," or a
  "Pakistan payment app."
- `career/career-research` had zero entries and no data folder - a pure registry leftover,
  redundant with the already-populated `career/business-research` (14 entries) covering the same
  ground. Removed from the registry entirely rather than kept as a second empty near-duplicate.

### Verification

Real browser, desktop and mobile (375px), both themes:

- Confirmed zero `/links` or `/companies` segments in any URL or breadcrumb, sitewide.
- `/technology` (a root with children, zero direct entries) renders the 13-subcategory tile grid
  correctly; `/technology/cli-terminal` (a leaf) renders its 2 entries with the
  `Technology / CLI & Terminal` breadcrumb.
- `/entry/ghostty` renders the full category breadcrumb and the bidirectional alternatives
  relationship (Warp links to Ghostty in one direction only in the YAML; both pages show the
  other).
- `/career/companies` still renders exactly as before (country/industry/hiring/remote/size
  facets, Recent/Hiring-first toggle) and its `View YAML` link and breadcrumb both point at the
  new `data/career/companies/...` path.
- Mega-menu: desktop hover and mobile tap-to-expand both verified via direct DOM/JS inspection
  (not just screenshots, which have a known capture artifact on this sticky/blurred header noted
  in the previous entry) - Career's panel shows Companies first with a divider, then its four real
  subcategories.
- `/finance/payment-processing-exchange-rates` resolves correctly and lists both migrated entries.
- Dark mode toggled correctly with no console errors across every page visited.
- `npm test` 86/86 (2 tests updated to assert unbounded depth instead of a two-segment cap - both
  failed first against the old assertion, confirming they were exercising the real change, not
  rewritten to vacuously pass), `npm run validate` 218/218, `astro check` 0/0/0, site builds to
  273 pages.

This closes out the taxonomy/routing follow-up correction.
