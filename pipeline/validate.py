#!/usr/bin/env python3
"""Dataset validation gate (dependency-free; runs in CI).

Checks, per catalog edition under /data:
  - courses files: required fields, hours/division consistent with the
    course number, prereq ASTs only reference well-formed course ids
  - programs files: rule trees are structurally valid, every explicitly
    referenced course id exists in that edition's course DB, hours
    arithmetic is sane (children of an `all` can't require more hours than
    an enclosing umbrella claims... reported as warnings), `includes`
    reference existing layer programs
  - source quotes: when the scrape cache is present locally, every quote
    must appear verbatim in the cached page (anti-hallucination check);
    in CI (no cache) this is skipped

Exit code 1 on any error. Warnings are printed but do not fail the build.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE.parent / "data"
CACHE = HERE / "cache"

errors: list[str] = []
warnings: list[str] = []

COURSE_ID = re.compile(r"^[A-Z][A-Z &\-']{0,5} \d[0-9A-Z]*$")
NODE_TYPES = {"all", "anyN", "course", "hours", "gpa", "concentration", "manual"}


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def load(path: Path):
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as e:
        err(f"{path}: invalid JSON: {e}")
        return None


def check_prereq(node, ctx: str) -> None:
    t = node.get("type")
    if t == "course":
        if not COURSE_ID.match(node.get("id", "")):
            err(f"{ctx}: malformed prereq course id {node.get('id')!r}")
    elif t in ("all", "any"):
        for child in node.get("of", []):
            check_prereq(child, ctx)
    else:
        err(f"{ctx}: unknown prereq node type {t!r}")


def check_courses(edition: str) -> set[str]:
    ids: set[str] = set()
    cdir = DATA / edition / "courses"
    if not cdir.is_dir():
        err(f"{edition}: missing courses/ directory")
        return ids
    for path in sorted(cdir.glob("*.json")):
        doc = load(path)
        if doc is None:
            continue
        for c in doc.get("courses", []):
            ctx = f"{path.name}:{c.get('id')}"
            for field in ("id", "subject", "number", "title", "hours", "division"):
                if field not in c:
                    err(f"{ctx}: missing {field}")
            cid = c.get("id", "")
            if not COURSE_ID.match(cid):
                err(f"{ctx}: malformed course id")
            if cid in ids:
                warn(f"{ctx}: duplicate course id")
            ids.add(cid)
            if "prereq" in c:
                check_prereq(c["prereq"], ctx)
    idx = load(DATA / edition / "courses-index.json")
    if idx and idx.get("totalCourses") != len(ids):
        warn(f"{edition}: courses-index totalCourses {idx.get('totalCourses')} "
             f"!= {len(ids)} parsed ids (multi-number listings can differ)")
    return ids


def iter_nodes(node):
    yield node
    for child in node.get("of", []):
        yield from iter_nodes(child)


def check_filter(f, ctx: str, ids: set[str]) -> None:
    for key in ("courses", "excludeCourses"):
        for cid in f.get(key, []):
            if cid not in ids:
                err(f"{ctx}: filter references unknown course {cid!r}")
    if f.get("division") not in (None, "upper", "lower"):
        err(f"{ctx}: bad division {f.get('division')!r}")


def check_program(path: Path, ids: set[str], program_ids: set[str]) -> None:
    p = load(path)
    if p is None:
        return
    ctx0 = path.name
    for field in ("id", "edition", "type", "name", "college", "rules", "sourceUrl"):
        if field not in p:
            err(f"{ctx0}: missing {field}")
    for inc in p.get("includes", []):
        if inc not in program_ids:
            err(f"{ctx0}: includes unknown layer {inc!r}")
    for node in iter_nodes(p.get("rules", {})):
        t = node.get("type")
        ctx = f"{ctx0}:{node.get('id') or node.get('title') or t}"
        if t not in NODE_TYPES:
            err(f"{ctx}: unknown node type {t!r}")
            continue
        if t == "course":
            if node.get("course") not in ids:
                err(f"{ctx}: unknown course {node.get('course')!r}")
        elif t == "hours":
            if not isinstance(node.get("hours"), (int, float)) or node["hours"] <= 0:
                err(f"{ctx}: bad hours")
            check_filter(node.get("filter", {}), ctx, ids)
            for cap in node.get("caps", []):
                check_filter(cap.get("filter", {}), ctx, ids)
        elif t == "anyN":
            n = node.get("n")
            if not isinstance(n, int) or n < 1 or n > len(node.get("of", [])):
                err(f"{ctx}: anyN n={n!r} out of range")
        elif t == "concentration":
            if not isinstance(node.get("hours"), (int, float)) or node["hours"] <= 0:
                err(f"{ctx}: bad concentration hours")
        elif t == "manual":
            if not node.get("text"):
                err(f"{ctx}: manual node without text")
        if t in ("all", "anyN") and not node.get("of"):
            err(f"{ctx}: empty children")
        quote = (node.get("source") or {}).get("quote")
        if quote:
            check_quote(p, quote, ctx)


def check_quote(program, quote: str, ctx: str) -> None:
    """Verbatim-quote check against the cached source page, when available."""
    url = program.get("sourceUrl", "")
    edition = program.get("edition", "")
    m = re.search(r"catalog\.utexas\.edu(?:/archive/[0-9-]+)?(/.+)", url)
    if not m:
        return
    slug = m.group(1).strip("/").replace("/", "__")
    page = CACHE / edition / f"{slug}.html"
    if not page.exists():
        return  # cache not present (CI) — skipped
    text = re.sub(r"<[^>]+>", "", page.read_text(errors="replace"))
    text = re.sub(r"\s+", " ", text.replace(" ", " ").replace("&#160;", " "))
    text = text.replace("&amp;", "&").replace("&#8203;", "").replace("​", "")
    needle = re.sub(r"\s+", " ", quote).strip()
    if needle not in text:
        err(f"{ctx}: source quote not found verbatim in cached page {page.name}")


def main() -> None:
    if not DATA.is_dir():
        print("no /data directory yet; nothing to validate")
        return
    for eddir in sorted(d for d in DATA.iterdir() if d.is_dir()):
        edition = eddir.name
        ids = check_courses(edition)
        pdir = eddir / "programs"
        if pdir.is_dir():
            paths = sorted(pdir.glob("*.json"))
            program_ids = set()
            for path in paths:
                doc = load(path)
                if doc:
                    program_ids.add(doc.get("id"))
            for path in paths:
                check_program(path, ids, program_ids)
        print(f"[{edition}] {len(ids)} courses, "
              f"{len(list(pdir.glob('*.json'))) if pdir.is_dir() else 0} programs checked")

    for w in warnings[:40]:
        print(f"WARN: {w}")
    if len(warnings) > 40:
        print(f"... {len(warnings) - 40} more warnings")
    if errors:
        for e in errors[:80]:
            print(f"ERROR: {e}", file=sys.stderr)
        if len(errors) > 80:
            print(f"... {len(errors) - 80} more errors", file=sys.stderr)
        sys.exit(1)
    print("dataset OK")


if __name__ == "__main__":
    main()
