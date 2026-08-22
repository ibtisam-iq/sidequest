<div align="center">

# sidequest

**An open directory of things worth remembering.**

Tools, GitHub repos, articles, books, courses, communities, remote job boards, referral links —
plus a directory of notable tech companies, organised by country.

[**sidequest.ibtisam-iq.com**](https://sidequest.ibtisam-iq.com) ·
[Browse links](https://sidequest.ibtisam-iq.com/links) ·
[Companies](https://sidequest.ibtisam-iq.com/companies) ·
[Add an entry](https://github.com/ibtisam-iq/sidequest/issues/new/choose)

[![Validate](https://github.com/ibtisam-iq/sidequest/actions/workflows/validate.yml/badge.svg)](https://github.com/ibtisam-iq/sidequest/actions/workflows/validate.yml)
[![Deploy](https://github.com/ibtisam-iq/sidequest/actions/workflows/deploy.yml/badge.svg)](https://github.com/ibtisam-iq/sidequest/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

## What this is

I kept finding good things while browsing and losing them again — a bookmark folder with 400
unsorted links is not a system. sidequest is that pile turned into something searchable, with
enough structure to stay useful as it grows.

It's inspired by [Awesome Lists](https://github.com/sindresorhus/awesome) and
[free-for.dev](https://free-for.dev), but built to do the two things a markdown list can't:

- **Scale** — hundreds of categories and thousands of entries, without a slow build or an
  unusable page.
- **Look like a product** — real search, filtering by category, tag, priority and audience, light
  and dark themes. Not a README rendered as HTML.

Every entry is a **flat YAML file in git**. There is no database and no accounts. If this site
disappears tomorrow, the data is still a folder of readable text files you can grep, fork, or
import somewhere else.

## Two kinds of entry

**Links** — anything worth saving: a tool, a repo, an article, a course, a community, a job board.

```yaml
# data/links/dev-tools/ghostty.yaml
url: https://ghostty.org
title: Ghostty
category: dev-tools
description: A fast, native, GPU-accelerated terminal emulator with zero-config sane defaults.
tags: [terminal, cli, open-source]
priority: high
audience: [developers]
alternatives: [warp]
date_added: "2026-08-18"
source: local
```

**Companies** — a proper directory, not just a link, because companies need country, industry and
hiring filters that a tool entry has no use for.

```yaml
# data/companies/pakistan/arbisoft.yaml
name: Arbisoft
website: https://arbisoft.com
country: pakistan
industry: software-development
size: mid
remote_policy: hybrid
hiring_status: actively-hiring
rating: Lahore-based product engineering firm known for long-running partnerships.
date_added: "2026-07-11"
source: local
```

Starting with Pakistan and expanding to the US, Canada and remote-friendly companies as the
research grows.

## A few things it does

- **Search** across every entry, client-side via [Pagefind](https://pagefind.app) — no server.
- **Filters** that combine: OR within a facet, AND across facets, with the state kept in the URL
  so a filtered view is linkable.
- **Alternatives, both ways.** An entry lists similar tools, and the relationship shows up on both
  entries — if A names B, B's page shows A without anyone having to write it twice.
- **An open taxonomy.** Categories aren't a fixed enum; they're a registry that grows, with fuzzy
  matching to stop `ai-tool` and `ai-tools` both existing.
- **A JSON API** at [`/api/entries.json`](https://sidequest.ibtisam-iq.com/api/entries.json), and
  an [`llms.txt`](https://sidequest.ibtisam-iq.com/llms.txt) describing the data model for agents.

## Contributing

**Two paths, both first-class** — see [CONTRIBUTING.md](CONTRIBUTING.md) for the detail.

1. **[Fill in a form.](https://github.com/ibtisam-iq/sidequest/issues/new/choose)** No YAML, no
   clone, works fine from a phone. A bot checks for duplicates, generates the entry, validates it,
   and opens a PR for you.
2. **Edit the YAML** and open a PR yourself, or run `npm run add-link` for a guided prompt.

New categories are welcome — the taxonomy is meant to grow.

## Running it locally

Requires **Node 22.12+**.

```bash
git clone https://github.com/ibtisam-iq/sidequest.git
cd sidequest
npm install
```

Working with the data:

```bash
npm run add-link          # guided prompt for a new link
npm run add-company       # guided prompt for a new company
npm run validate          # validate the whole dataset (same script CI runs)
npm run validate -- --report   # ...plus per-category counts
npm test                  # unit tests for the shared helpers
```

Running the site:

```bash
cd site
npm install
npm run dev               # dev server
npm run build             # astro build + pagefind index
npm run preview           # serve the built output
```

> Search doesn't work under `npm run dev`. Pagefind indexes the *built* HTML, so the index only
> exists after `npm run build` — use `npm run preview` to try search locally. This is expected.

## Repo layout

```
data/links/<category>/<slug>.yaml       the entries
data/companies/<country>/<slug>.yaml
taxonomy/categories.yaml                the open category/country registry
schema/*.json                           JSON Schema — the source of truth for validation
scripts/                                validation, the CLIs, shared helpers
site/                                   the Astro site
.github/                                issue forms and workflows
```

[CLAUDE.md](CLAUDE.md) is the full working context — data model, conventions, and how everything
fits together. [STATUS.md](STATUS.md) is the build log.

## How it's built

Astro (static output) · Pagefind for search · plain YAML for data · Node scripts for validation ·
GitHub Actions · GitHub Pages. No database, no framework runtime, no tracking.

The JSON Schemas are the single source of truth: `scripts/validate.mjs` enforces them with ajv in
CI and locally, and the site's Zod schemas are generated from the same files, so the two can't
drift.

## License

[MIT](LICENSE) — do what you like with the code and the data. Attribution appreciated.
