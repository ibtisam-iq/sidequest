# Contributing to sidequest

Suggestions are genuinely welcome - a directory is only as good as what's in it. There are **two
ways to add an entry**, and both are first-class. Pick whichever suits you.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you submit: what actually belongs here

sidequest is **not** a comprehensive directory of the best or most important tools in any
category - it's a log of things worth rescuing from being forgotten, specifically things found
incidentally while doing something else, that are useful but not already famous or well-known.

**Don't submit tools that are already famous or that most people in the relevant field already
know about** - LinkedIn, YouTube, Google, and the like. If you found it in five seconds of
googling "best X tools," it's probably too well-known for this directory. The obscure and easily
forgotten is the whole point.

---

## Path 1 - Fill in a form (no YAML, no clone)

**[→ Add an entry](https://github.com/ibtisam-iq/sidequest/issues/new/choose)**

Pick *Add a link* or *Add a company*, fill in the fields, submit. This works fine from a phone.

What happens next is automatic:

1. The URL is checked against the **whole directory**. If it's already there, you get a comment
   pointing at the existing entry and no PR is opened.
2. Your input is normalized - tracking parameters stripped from the URL, tags lowercased and
   de-duplicated, the category turned into a slug.
3. The YAML file is generated and **validated** before anything is opened, so you never get a PR
   that's already broken.
4. A pull request opens, linked to your issue, and closes it when merged.

If something's wrong with the submission, the bot comments on the issue with the reasons. **Edit
the issue** and it re-runs automatically - no need to open a new one.

### What good input looks like

- **URL** - the canonical page, not a redirect or a search result. `?utm_source=…` is fine, it
  gets stripped.
- **Category** - one of the six fixed roots (`career`, `faith`, `finance`, `learning`,
  `lifestyle`, `technology`), optionally with `/sub` for a subcategory (e.g. `technology`,
  `technology/ai-coding-agents`). Check [`taxonomy/categories.yaml`](taxonomy/categories.yaml) for
  the current subcategories and reuse one if it fits - a genuinely new subcategory is welcome (see
  below), but the six roots themselves don't change. If an entry could plausibly fit more than one
  root, see the classification precedence rule in [CLAUDE.md](CLAUDE.md). Entries under
  `learning/books-academic-papers`, `lifestyle/movies-torrents`, or
  `technology/cracked-software-apks` automatically get a legal-risk warning badge - only use those
  for shadow libraries and similar copyright-risk resources, not as a shortcut for "unsure where
  this goes."
- **Tags** - comma-separated, as many as are useful. Free-form; there's no fixed list.
- **Priority** - how strongly *you'd* recommend it. Be honest; `medium` is a fine answer.
- **Hiring status** (companies) - leave it `Unknown` unless you're confident. It goes stale fast
  and a wrong "actively hiring" is worse than no answer.

---

## Path 2 - Edit the YAML yourself

Requires **Node 22.12+**.

```bash
git clone https://github.com/ibtisam-iq/sidequest.git
cd sidequest
npm install
```

### Guided (recommended)

```bash
npm run add-link
npm run add-company
```

These prompt for each field, warn you if the URL is already in the directory, fuzzy-check the
category against the registry, write the file, and re-run validation.

### By hand

Create a file at `data/links/<root>/<slug>.yaml` (or `data/links/<root>/<sub>/<slug>.yaml` for a
subcategory, `root` being one of career/faith/finance/learning/lifestyle/technology) or
`data/companies/<country>/<slug>.yaml`, then:

```bash
npm run validate
```

Open a PR once it passes. CI runs the identical script, so a green local run means a green PR.

---

## The rules validation enforces

`npm run validate` checks all of these. None of them are stylistic - each one prevents a real
problem:

| Rule | Why |
|---|---|
| Matches the JSON Schema in `schema/` | The schema is the single source of truth for both CI and the site |
| No duplicate URLs anywhere in the dataset | Compared after normalization, so `www.` / tracking params / trailing slashes can't sneak a duplicate past |
| Category path (or country) resolves in `taxonomy/categories.yaml` | Stops typo'd categories creating orphan folders. For links, both the root and, if given, the subcategory must be registered under it |
| Folder path matches the entry's `category`/`country` field | The two must agree or the site routes to the wrong place |
| Entry slug is unique **within its collection** | `alternatives` references entries by bare slug, so links must be unambiguous. A link and a company *may* share a slug |
| `alternatives` point at real link entries | A dangling reference would silently render nothing |
| `legal_risk: true` is set on every entry under `learning/books-academic-papers`, `lifestyle/movies-torrents`, or `technology/cracked-software-apks`, and never set elsewhere | A content-integrity rule, not a suggestion - it drives the visible warning badge |

### Two conventions worth knowing

**Dates must be quoted.** Write `date_added: "2026-08-22"`, never `date_added: 2026-08-22`.
Quoting guarantees it parses as a string across every YAML tool rather than becoming a timestamp.

**Slugs are the filename.** `data/links/technology/cli-terminal/ghostty.yaml` has the slug
`ghostty`. That's what `alternatives: [ghostty]` refers to, and what appears in the URL - the
category path doesn't factor in, since slugs only need to be unique within their collection.

---

## The open taxonomy - proposing a new subcategory

The **six top-level roots are fixed** - Career, Faith, Finance, Learning, Lifestyle, Technology -
and don't change. Subcategories underneath them are **not a fixed enum** and grow with the
directory. They live in [`taxonomy/categories.yaml`](taxonomy/categories.yaml), organized as a
**two-level tree** (only two levels are supported; a subcategory never itself has children):

```yaml
- slug: technology
  name: Technology
  type: links      # links | companies

- slug: ai-coding-agents
  name: AI Coding Agents
  type: links
  parent: technology  # makes this a subcategory of technology
```

A link's `category` field is a path: `technology` (flat) or `technology/ai-coding-agents` (with a
subcategory). For **companies** the registry key is the **country**, and it's always flat -
industry is deliberately free-form and not registered, because companies vary too widely for a
curated list to be worth maintaining.

**Adding a subcategory is expected, not exceptional.** You don't need permission:

- Via the **issue form**: type `root` or `root/sub`. A subcategory that doesn't exist yet is
  registered automatically, and the PR says so.
- Via **`npm run add-link`**: pick the root first, then either an existing subcategory or
  *Create a new subcategory*.
- **By hand**: append a record to the registry (with `parent:` set to the root) and create the
  matching folder.

### The near-duplicate check

The thing that actually kills an open taxonomy is fragmentation - `ai-chat-assistant`,
`ai-chat-assistants` and `ai_chat_assistants` all existing because nobody checked. So a new
subcategory is fuzzy-matched (Levenshtein) against its **siblings only** - a new subcategory of
Technology is checked against Technology's other subcategories, never against subcategories under
a different root:

- In the **CLI**, you get a prompt: *"You typed `ai-chat-assistant`, but `ai-chat-assistants`
  already exists - did you mean that?"* You can override it if the subcategory really is
  distinct.
- In the **issue-form flow** it's a **warning in the PR body, not a failure** - a human reviewer
  decides. Automation shouldn't get to veto a genuinely new subcategory.

**Counts are never stored** in the registry. They're computed at build time and by
`npm run validate -- --report`. A stored count would put every single-entry PR on the same line of
one shared file, guaranteeing conflicts between concurrent contributions.

---

## Working on the site

```bash
cd site
npm install
npm run dev
```

> **Search does not work on the dev server.** Pagefind indexes the *built* HTML, so the index only
> exists after a build. Use `npm run build && npm run preview` to test search locally. This is
> expected, not a bug.

Before opening a PR that touches the site:

```bash
npm run build      # in site/
npx astro check    # should report 0 errors, 0 warnings, 0 hints
```

And please actually open it in a browser - check the change at a mobile width and in both themes.
A green build is not evidence that a feature works.

### A note on the design

Themes are driven entirely by CSS custom properties in `site/src/styles/global.css`. Light is the
base; dark overrides only the tokens. **Don't hard-code a colour in a component** - add or reuse a
token, otherwise it will break in one of the two themes.

---

## What won't be merged

- **Engagement features** - upvotes, bookmark counts, "verified" badges, comments, accounts. These
  all need a backend and user accounts, which contradicts the static flat-file design the whole
  repo rests on. This is a settled decision, not an oversight.
- **Affiliate or referral links presented as ordinary entries.** Disclosing it in the `note` field
  is fine - just be upfront about it.
- **Link-farm submissions**, SEO spam, or bulk-added entries with no personal note or context.
- **Dead or paywalled-without-warning links.**

## Forking this repo

Two things aren't carried over by a fork and will silently break the issue-form pipeline until you
set them up:

1. **The labels.** The forms apply `new-link` / `new-company` and the workflow routes on them, but
   GitHub doesn't create them from the form definition:

   ```bash
   gh label create new-link     --color 1D76DB --description "Issue-form submission for a new link entry"
   gh label create new-company  --color 0E8A16 --description "Issue-form submission for a new company entry"
   gh label create automated-pr --color 5319E7 --description "PR opened automatically from an issue form"
   ```

2. **Workflow permissions.** Settings → Actions → General → Workflow permissions needs *Read and
   write* plus *Allow GitHub Actions to create and approve pull requests*, or `issue-to-pr.yml`
   can't open the PR.

For Pages, set Settings → Pages → Source to **GitHub Actions**, and point `site/public/CNAME` and
`astro.config.mjs` at your own domain (or delete the CNAME to use `<user>.github.io`).

## Questions

Open a [discussion](https://github.com/ibtisam-iq/sidequest/discussions). For how the codebase
fits together, [CLAUDE.md](CLAUDE.md) is the full working context and [STATUS.md](STATUS.md) is the
build log.
