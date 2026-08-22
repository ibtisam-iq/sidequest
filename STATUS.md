# STATUS — sidequest build log

Append-only running log of what has actually been built. Newest entries at the bottom.
Never overwrite a prior entry.

Read `CLAUDE.md` first for working context, then this file for current state.
`docs/PLAN.md` holds the approved build plan.

---

## 2026-08-22 — Phase 1/10 (~10%) — Repo scaffold

**Built**

- `.claude/settings.json` with `includeCoAuthoredBy: false` (pre-existing, confirmed correct)
  so no commit or PR body carries a `Co-Authored-By` / "Generated with Claude Code" trailer.
- `CLAUDE.md` — full working context: what the project is, repo structure, both entity schemas,
  the open taxonomy system, conventions, how to run everything, what each script does, the
  Actions overview, and the issue-form security rules.
- `STATUS.md` — this file.
- `docs/PLAN.md` — the approved build plan, committed so it survives the session.
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1.
- Root `package.json` and `.gitignore`.

**Verified against the live registry / Astro tarball rather than assumed**

- Astro **7.2.4** is current, requires Node ≥22.12.0 (local v25.6.0 ✓). CI will pin Node 22.
- Astro 7 still ships `astro/loaders` (`glob`, `file`) and `astro/zod`; `glob({ base })` accepts an
  absolute file URL **outside** the site root — this is what lets Astro read repo-root `data/`
  with no copying or symlinking.
- `.yaml`/`.yml` is a registered data entry type in Astro core, so the glob loader parses YAML
  natively — no custom parser needed.
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

**Next:** Phase 2 — `schema/link.schema.json`, `schema/company.schema.json`,
`taxonomy/categories.yaml` seeded with 10 real link categories + `pakistan`, and 8–10 real seed
entries including a mutually-linked `alternatives` pair to prove the schemas out.

---

## 2026-08-22 — Phases 2 & 3/10 (~30%) — Schemas, taxonomy, seed data, validation

**Phase 2 — schemas, taxonomy, seed data**

- `schema/link.schema.json` and `schema/company.schema.json`, draft-07, `additionalProperties:
  false`, `format: date`/`format: uri` plus explicit regex patterns (JSON Schema `format` is
  advisory in some validators, so the patterns do the real enforcement).
- `taxonomy/categories.yaml` seeded with 10 link categories (`dev-tools`, `ai-tools`,
  `github-repos`, `articles`, `books`, `courses`, `communities`, `remote-job-boards`,
  `referral-links`, `newsletters`) + `pakistan` for companies. Header comment documents the
  open-registry rules and why counts are not stored.
- **12 real seed entries** — 9 links, 3 Pakistani companies (Systems Limited, Arbisoft, NetSol).

**Alternatives are seeded asymmetrically on purpose.** `ghostty` declares `alternatives: [warp]`;
`warp` declares nothing. So Warp's page showing Ghostty is only possible via the computed reverse
map — that asymmetry is what makes the bidirectional feature genuinely testable instead of
trivially satisfied. Same setup for `cursor` → `claude-code` and `we-work-remotely` → `remoteok`.

**Phase 3 — shared libs + validation**

- `scripts/lib/url.mjs` — canonical URL form: forces https, strips `www.`, drops fragments,
  removes ~20 tracking params, sorts query params, trims trailing slash (except bare origins).
- `scripts/lib/slugify.mjs` — output is strictly `[a-z0-9-]`; accents folded, `&`/`+` spelled out.
  This is the filename-safety guarantee for the issue workflow.
- `scripts/lib/levenshtein.mjs` — hand-rolled, zero deps. Near-match fires at distance ≤2 **or**
  ratio <0.3; the proportional arm catches typos in long slugs that a flat distance rule misses.
- `scripts/lib/taxonomy.mjs`, `scripts/lib/yaml-io.mjs`, and the two thin CLI wrappers.
- `scripts/validate.mjs` with `--report` and `--check-duplicate-url` (exit 2 = duplicate).

**Verified by deliberately breaking things** — every case caught with a clear message, then reverted:

| Broken input | Result |
|---|---|
| Bad `priority` enum + missing `tags` | both errors reported |
| `https://www.warp.dev/?utm_source=…` vs existing `warp` | caught — normalized to the same URL |
| `alternatives: [does-not-exist]` | caught |
| Unregistered category | caught, with the fix suggested |
| Same slug twice within `data/links/` | caught |
| Same slug in links *and* companies | **correctly allowed** (per-collection scoping) |

- Fuzzy match confirmed firing on the real registry: `"AI Tool"` → *"did you mean: ai-tools?"*,
  `"Remote Job Bords!!"` → *"did you mean: remote-job-boards?"*, `"Podcasts"` → genuinely new.
- `npm test` — 28 unit tests passing over the pure lib functions.
- Fixed `npm test` to glob `scripts/lib/*.test.mjs`; a bare directory arg made Node treat the
  path as a single module and fail to load.

**Next:** Phase 4 — `add-link.mjs` / `add-company.mjs` interactive CLIs with `@clack/prompts`,
wired to the same fuzzy-match check.

---

## 2026-08-22 — Phase 4/10 (~40%) — Interactive CLIs

**Built**

- `scripts/lib/cli-shared.mjs` — the pieces both CLIs need: cancel handling, URL prompt with
  live duplicate rejection, tag/optional-text prompts, `pickCategory` (the fuzzy-guarded
  category/country picker), collision-safe filename resolution, and write-then-validate.
- `scripts/add-link.mjs` and `scripts/add-company.mjs`.

Both check the new URL against **the whole dataset** (links *and* companies) before anything is
written, and re-run the real `validate.mjs` afterwards so a bad entry can't be left behind
silently.

**Verified**

Driving these through a real TTY turned out to be unreliable in this environment (`script`-based
pty automation produced no captured output), so verification was done two better ways instead:

1. **`scripts/lib/cli-shared.test.mjs`** — mocks the prompt layer via `mock.module` and exercises
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

- `writeYaml` passed `quotingType: '"'`, which is a **silent no-op in js-yaml 5** — it emits
  single quotes regardless. Removed the misleading option and pinned the invariant that actually
  matters in `scripts/lib/yaml-io.test.mjs`: dates must round-trip as **strings**, never Date
  objects. If a future js-yaml upgrade changes that, the test fails loudly.
- The picker test initially leaked an empty `data/links/ai-tool/` directory — git doesn't report
  empty directories, so it went unnoticed until the folder listing was checked directly. Cleanup
  now covers every slug the tests register.

**Next:** Phase 5 — the Astro site: content collections reading repo-root `data/`, landing page,
`/links` and `/companies` browsing with pagination, entry pages, Pagefind search, and the SEO set
(sitemap, robots.txt, 404, llms.txt, JSON-LD).

---

## 2026-08-22 — Phases 5 & 6/10 (~65%) — Astro site, alternatives, dark mode, responsive

**Astro 7 wiring**

- `site/src/content.config.ts` — `links` and `companies` load from the **repo-root `data/`**
  directory via `glob({ base: new URL('../../data/…') })`, with `generateId` returning the bare
  filename so `alternatives: [obsidian]` stays human-writable. No copying, no symlinks.
- `taxonomy/categories.yaml` loads via `file()` with an explicit parser, since the registry is
  keyed by slug **and** type — the same slug can legitimately exist for both entity types.
- `scripts/gen-zod-schemas.mjs` generates the zod schemas from `schema/*.json` at
  `predev`/`prebuild`, so the JSON Schema stays the single source of truth.

**Pages** (28 built): landing page, `/links` + `/companies` browse, paginated
`/{links,companies}/<group>/[...page]` at 24/page, entry detail pages under `entry/<slug>`,
`/search`, a real `404.astro`, and a prerendered `/api/entries.json`.

Entries are grouped into a Map **once** before iterating categories in `getStaticPaths` — O(n)
rather than O(n×categories), which is the difference between a fast build and a crawling one at
scale.

**Browse design decision.** Cards are rendered server-side and filtering toggles visibility on the
existing DOM nodes, rather than re-rendering from JSON on the client. This keeps card markup in
exactly one place (`EntryCard.astro`), so a filtered view can never drift from the server-rendered
one, and every entry stays in the HTML with JS off. The cost is page weight growing with the
dataset — fine into the low thousands, and the threshold for switching to client-side rendering is
documented in `Browse.astro`. Per-category pages stay paginated regardless, so the crawlable path
never depends on it.

**Alternatives (Phase 6).** Built once per build in `site/src/lib/data.ts`, unioning forward and
reverse references. Reverse-only relationships get a "↩ links back here" marker.

**Dark mode.** Token-based, three-state (system/light/dark), with a blocking inline script in
`<head>` so there is no flash of the wrong theme. Zero dependencies.

**SEO.** `@astrojs/sitemap` (confirmed working on Astro 7 — the fallback was not needed),
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
   sentence in their place — excerpts now read naturally and `fintech` is still searchable.
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

**Next:** Phase 7 — Issue Forms, `parse-issue-form.mjs`, and the three workflows.
