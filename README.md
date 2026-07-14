# bailey-inglish.github.io

Personal site (static reports at the root) plus the **UT Degree Planner**, an
unofficial degree-audit and semester-planning web app for UT Austin students,
served at `/degree-planner/`.

## UT Degree Planner

Upload your Academic Summary (UT's unofficial transcript) and the app audits
your coursework against every encoded major, minor, and certificate across
catalog editions — the inverse of UT's IDA, which audits you against one
declared program. Results feed a drag-and-drop semester planner that obeys
prerequisite chains and supports summer/study-abroad terms.

Everything runs client-side: the transcript is parsed in the browser and never
uploaded anywhere.

### Repo layout

| Path | What it is |
|---|---|
| `app/` | React + TypeScript + Vite SPA (pdf.js ingestion, audit engine, dnd-kit planner) |
| `pipeline/` | Python dataset builder: catalog scraper, course parser, core-curriculum extractor, program encodings, validator |
| `data/` | The committed dataset: per-subject course DBs and program requirement trees per catalog edition |
| `docs/PLAN.md` | Full build plan and architecture decisions |
| `*.html` at root | Pre-existing static reports (untouched by the app build) |

### Dataset pipeline

```
pipeline/scrape.py courses          # cache catalog HTML (courses A-Z, per edition)
pipeline/parse_courses.py           # -> data/<ed>/courses/*.json (deterministic)
pipeline/extract_core.py            # -> core curriculum layer (machine-extracted)
pipeline/extract_programs.py        # -> program rule trees (LLM-assisted encodings)
pipeline/validate.py                # CI gate: schema, referential integrity, quotes
```

Requirement rules are a small JSON DSL (`all` / `anyN` / `course` / `hours` /
`gpa` / `manual`) documented in `app/src/engine/types.ts`. Every rule carries a
verbatim quote + URL from its catalog page; prose that resists formalization
becomes a visible `manual` checklist item, never a silent omission.

### App development

```
cd app
npm install
npm run dev      # copies /data into public/ and serves the SPA
npm test         # vitest: parser, engine, planner suites
npm run build    # typecheck + production bundle
```

### Deployment

`.github/workflows/deploy.yml` assembles the Pages artifact: repo-root static
files stay at `/`, the built app lands in `/degree-planner/`. Repo Settings →
Pages → Source must be **GitHub Actions**.

### Status / coverage

Course DBs cover all subjects for the 2024-2026 and 2022-2024 catalogs.
Programs: ~250 per edition — every college's majors, minors, and
transcript-recognized certificates via the automatic extractor
(`pipeline/extract_auto.py`), plus hand-curated encodings for BS Statistics &
Data Science, Plan II Honors, BA Economics, BA Government, the shared
university/core/college layers, the SDS minor, and the Pre-Health
certificate. Curated encodings always override auto ones.

There are **zero manual checks**: every requirement is formalized into an
evaluable rule (course lists, hour/GPA rules, single-field concentrations
including "one foreign language", "N courses chosen from" → any-N, etc.).
Catalog language that isn't an auto-checkable course rule (advisor
approvals, "approved list" pointers, policies) renders as inert `note`
context. Approved-course lists the catalog only points to — e.g. the
College of Liberal Arts social-science and cultural-expression lists — are
scraped (`pipeline/scrape_lists.py`) into `data/<edition>/lists.json` and
referenced by name (`filter.list`) so many programs share one list.

**Not affiliated with UT Austin. IDA and academic advisors are authoritative.**
