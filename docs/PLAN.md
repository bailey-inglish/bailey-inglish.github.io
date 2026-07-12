# UT Degree Audit & Planner — Build Plan

## Context

Goal: a production web app for UT Austin students that inverts UT's Interactive Degree Audit (IDA). Instead of auditing yourself against one declared major, you upload your **Academic Summary** (UT's unofficial transcript) and the app audits you against **every** major, minor, and certificate across all active catalogs, ranks programs by how close you are to completing them, and feeds everything into a drag-and-drop multi-semester schedule planner that obeys prerequisite rules and supports study abroad / summer configurations.

The repo (`bailey-inglish.github.io`) is a bare GitHub Pages site — a few static pandoc reports and a Jekyll subsite, no build tooling, no CI. Clean slate; existing files must keep working at their current URLs.

## Research findings (drive every design decision below)

1. **Catalog source**: `catalog.utexas.edu` (CourseLeaf), public HTML. Archives back to 2012-2014. "Active" catalogs — the ones any current undergrad can graduate under — are **2020-2022, 2022-2024, 2024-2026 (+ 2025-26 addendum)**. ~110 majors across 16 colleges/schools; minors & certificates listed per-college under `/minor-and-certificate-programs/`.
2. **Requirements are prose, not tables.** E.g. Economics BA: *"At least 32 semester hours of economics, consisting of Economics 304K, 304L, 420K or 420S, 320L, 329, 341K or 441K, 101S, and 12 additional hours of upper-division coursework. At least six of the …"*. Deterministic parsing alone cannot cover this; structured extraction with LLM assistance + validation is required.
3. **Course descriptions** (`/general-information/coursesatoz/<subj>/`) are semi-structured: `<h5>ECO 304L (TCCN: ECON 2301). Title.</h5><p>…Prerequisite: <a class="bubblelink">Economics 304K</a> with a grade of at least C-.</p>`. Course references inside prereq prose are marked with `bubblelink` anchors → prereq extraction is highly tractable. TCCN codes give transfer-credit mapping for free.
4. **UT course numbers are self-describing**: first digit = credit hours (ECO **4**20K = 4 hrs); last two digits 01–19 = lower-division, 20–79 = upper-division, 80+ = graduate. Hours and division are deterministic.
5. **A full audit is layered**: university core curriculum (42 hrs, component lists in catalog) + skills/experience **flags** + college/degree-level rules (e.g. BA Plan I shared requirements: foreign language, upper-division hours, residency, GPA) + major-specific rules. Each layer lives on a different catalog page; program pages assume the shared layers.
6. **Gaps**: semester-by-semester offerings and per-section flag data live in the EID-gated course schedule (not scrapeable server-side). The registrar publishes public **four-year degree plan templates** (SB 25) usable as planner seeds. Precedent: UT Registration Plus (Longhorn-Developers, open source) solves schedule data by running in the student's browser session — out of scope for v1, noted as future path.
7. **Academic Summary** (Texas One Stop): per-semester UT + transfer coursework, grades, classification, UD/LD/cumulative GPA, total hours, current major. Downloadable/printable from UT Direct → PDF parseable client-side. **I need one real redacted sample from you to lock the parser** (format isn't publicly documented).

## Decisions (defaults chosen; override any at review)

| Decision | Choice | Why |
|---|---|---|
| Architecture | **Fully client-side SPA, backend-ready** | Transcript never leaves the browser (privacy/FERPA-adjacent), zero hosting cost on Pages. Storage behind an interface (localStorage + JSON export/import) so accounts/sync can be added later without rework. |
| Stack | React + TypeScript + Vite, dnd-kit for drag-drop, pdf.js for PDF parsing, Vitest + Playwright | Boring, proven, static-deployable. |
| Rule extraction | **Deterministic scrape → LLM-assisted extraction into a strict rules schema → automated validation + sampled human audit** | Only approach that scales to ~110 majors × 3 catalogs of prose with auditable quality. I perform extraction in-session (I am the LLM); prompts + scripts are committed so the pipeline is rerunnable with an API key later. |
| Catalog scope | **Active catalogs (2020-2026 + addendum)**; pipeline is year-agnostic so 2012+ can be backfilled later | Covers every enrolled student; halves the validation burden vs. full archive. |
| Ingestion | **PDF upload + paste-text fallback + full manual editor** | Robust to format quirks; manual editor doubles as the "edit/add planned classes" feature. |
| Deployment | GitHub Actions → Pages artifact = existing static files + app built at `/degree-planner/` | Existing report URLs untouched. |

## Repo layout

```
/app/                 # Vite React TS SPA
/pipeline/            # Python: scrape, cache, extract, validate (rerunnable)
  /cache/             # raw HTML snapshots (committed: reproducibility + diffing)
  /prompts/           # extraction prompt templates
/data/                # THE DATASET (committed, versioned JSON + JSON Schemas)
  schema/             # JSON Schema for every file type
  2024-26/ 2022-24/ 2020-22/
    courses.json  programs.json  core.json
  equivalences.json   # cross-listings, "same as", TCCN map
/docs/PLAN.md         # this plan
/.github/workflows/   # ci.yml (test+validate data), deploy.yml (Pages)
```

## The dataset (Phase 1 — the critical path)

### Requirements DSL (JSON, schema-validated)

Every program = metadata + a tree of rule nodes:

- **Node types**: `ALL`, `ANY_N` (choose k), `COURSE` (with `minGrade`), `HOURS` (n hours matching a filter), `GPA` (scope filter, min), `RESIDENCY`, `LIMIT` (caps/exclusions, e.g. "no more than 6 hrs of…", "may not count both X and Y"), `SEQUENCE`, `MANUAL` (verbatim prose that resists formalization — rendered as a checkbox with the catalog text, never silently dropped).
- **Filters**: subject set, explicit course list, number range, upper/lower division, level, exclusion list, flag, core component.
- Every node carries `source`: catalog URL + verbatim quoted text → auditability and in-app "show catalog language".
- Programs reference shared **layer definitions** (university core, college degree rules like "BA Plan I") rather than duplicating them.

### Course database (per catalog year)

Deterministic scrape of `coursesatoz`: id, subject, number → hours/division (from numbering rule), title, TCCN, description, cross-listings ("Same as"), restrictions ("Restricted to students in…"), and **prereq AST** (AND/OR tree with min grades) extracted from prose anchored on `bubblelink` links — LLM resolves the connective logic, validator checks every referenced course exists.

### Extraction pipeline & QA (how we trust it)

1. Scrape + cache all program/course/core pages for the 3 catalogs (public pages; polite rate-limiting; snapshots committed).
2. Segment each program page into requirement chunks deterministically (headings/paragraphs).
3. LLM extraction chunk → DSL nodes, quoting source text verbatim.
4. **Automated validation**: JSON Schema; every course id exists in that year's course DB; hours arithmetic consistent (children can satisfy parent totals); no orphan/cyclic prereqs; every source quote is a verbatim substring of the cached page (anti-hallucination check).
5. **Golden set**: ~10 hand-encoded diverse programs (BA/BS/BBA/engineering/minor/certificate) diffed against pipeline output; plus synthetic-transcript regression tests ("this fake transcript must show Econ major 87% complete").
6. Sampled human audit UI artifact: side-by-side catalog text vs. extracted rules for spot review.
7. Anything unresolvable becomes a `MANUAL` node — coverage is measured and reported (target: ≥95% of requirement hours machine-evaluable per program).

## The app

### Phase 2 — Transcript ingestion
`AcademicRecord` model: courses (term, subject, number, title, hours, grade, flags: in-residence/transfer/credit-by-exam/pass-fail), current major(s), classification, GPAs. Parsers: PDF (pdf.js text layer) and paste-text, sharing one tokenizer; fixture-driven tests **(blocked on your redacted sample — the one input I need from you)**. Manual course editor + "planned course" entries (term = future). Transfer courses map through TCCN/equivalences.

### Phase 3 — Audit engine + rankings
Pure TypeScript library (`app/src/engine/`), UI-independent, heavily unit-tested.
- **Matching**: a course can satisfy multiple filters; assignment of courses→requirements is an optimization (greedy + local-search swap pass) maximizing satisfied hours under `LIMIT`/double-counting constraints; ambiguities surfaced, not hidden.
- **Grade rules**: min-grade checks, pass/fail exclusions, GPA-by-scope computation.
- **Proximity score** per program: remaining hours (optimistic lower bound), unmet required courses, % complete, and "earliest completable semester" given prereq chains. Rankings screen = every major/minor/certificate sorted by proximity, filterable; drill-down shows the full requirement tree with met/unmet/manual states and catalog language.
- **Current-major awareness**: detected major (from summary) drives which restricted courses are available to the student (course `restrictions` field) and seeds the default plan; user can add/remove planned majors/minors/certificates and the audit unions their remaining requirements, optimizing shared/double-counted courses.

### Phase 4 — Schedule planner
- Term timeline from current semester → configurable graduation; per-term settings: max hours, summer on/off, **study abroad** (restricts to transfer-eligible placeholder slots), co-op/gap.
- **Auto-generate**: topological sort over prereq DAG + registrar four-year templates as seeds where they exist + requirement slotting (unmet `HOURS` filters become labeled placeholder slots like "UD ECO elective (3h)").
- **Drag-and-drop** (dnd-kit) across term columns with live validation badges: prereq violated, co-req split, hour cap exceeded, offering-pattern warnings (heuristic from catalog text like "offered in spring only"; marked as advisory since real offerings are EID-gated).
- Plan persistence (localStorage), multiple named scenarios, export/import JSON, printable plan + audit.

### Phase 5 — Production hardening
Disclaimer banner (unofficial; IDA/advisors authoritative — legally important), accessibility pass (keyboard DnD, ARIA), error boundaries, dataset version pinning (a saved plan remembers its catalog edition), Playwright e2e (upload fixture → rankings → drag course → violation appears), CI: typecheck, unit tests, **data validation gate** (schema + referential checks run on every PR touching `/data`), Pages deploy workflow preserving existing report URLs.

## Delivery order (each phase = reviewable PR(s))

1. **PR 1**: scaffold (app shell, CI, deploy workflow, this plan in `/docs`).
2. **PR 2**: pipeline + course DBs for 3 catalogs + schemas + validators (data volume: courses first — fully deterministic).
3. **PR 3+**: program extraction in college-sized batches (start: Liberal Arts + Natural Sciences + McCombs ≈ majority of students), each batch passing validation + golden tests.
4. **PR**: ingestion (needs your sample), **PR**: audit engine + rankings UI, **PR**: planner, **PR**: hardening.

## Verification

- `pipeline/validate.py` green across all data (schema, referential integrity, verbatim-quote check, coverage report).
- Golden-program diffs and synthetic-transcript regression suite in CI.
- Engine unit tests (Vitest) incl. adversarial cases: double-counting caps, C- minimums, pass/fail, transfer TCCN matching.
- Playwright e2e on built app; manual smoke: my own audit of 3 known degree plans against the official catalog by hand.
- Deploy preview: run built site locally (`vite preview`) and verify existing report URLs still resolve in the Pages artifact.

## Open items for you

1. **A redacted Academic Summary** (PDF + a copy-paste of its text) — the only external input that blocks a phase (Phase 2).
2. Confirm the four defaulted decisions (client-side architecture, LLM extraction, active-catalogs scope, PDF+paste ingestion).
3. Nice-to-have later: browser-extension companion (UTRP-style) for live offerings/flags; accounts/sync backend.

## Known limitations (stated in-app)

- Offerings/flags per semester are EID-gated → advisory heuristics only.
- Some college-specific double-counting policies are approximations → flagged in UI.
- Catalog prose that resists formalization appears as manual-check items, never silently ignored.
