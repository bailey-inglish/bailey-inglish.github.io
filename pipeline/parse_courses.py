#!/usr/bin/env python3
"""Parse cached courses A-Z pages into the per-subject course dataset.

Deterministic where UT's conventions allow it:
  - course number: first digit = credit hours; trailing A/B half-course
    suffixes carry half the hours; rank digits 01-19 lower-division,
    20-79 upper-division, 80-99 graduate
  - TCCN codes, "Same as" cross-listings, "May not be counted" exclusions,
    restriction sentences, offering hints
  - prerequisite ASTs built from the catalog's own course anchors
    (class="bubblelink") plus connective heuristics; anything ambiguous is
    kept as text with confidence="low" rather than guessed silently

Usage: python3 parse_courses.py [edition ...]
"""
import html as htmllib
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE.parent / "data"
EDITIONS = json.loads((HERE / "editions.json").read_text())

NBSP = " "


def clean(s: str) -> str:
    s = htmllib.unescape(s).replace(NBSP, " ")
    return re.sub(r"\s+", " ", s).strip()


def strip_tags(s: str) -> str:
    return clean(re.sub(r"<[^>]+>", "", s))


COURSE_NUM = re.compile(r"^(\d)(\d{2})([A-Z]*)$")


def number_meta(num: str):
    """hours + division from a UT course number like 304K, 610QA, 119S."""
    m = COURSE_NUM.match(num)
    if not m:
        return None
    first, rank, suffix = int(m.group(1)), int(m.group(2)), m.group(3)
    # Half-course suffixes are the trailing A/B on a two-letter suffix pair
    # (610QA/610QB, 679HA/679HB): each half carries half the total hours.
    # A lone A/B topic letter (e.g. 315A) is a normal topic suffix.
    if len(suffix) >= 2 and suffix[-1] in "AB" and first % 2 == 0:
        hours = first / 2
    else:
        hours = float(first)
    if rank <= 19:
        division = "lower"
    elif rank <= 79:
        division = "upper"
    else:
        division = "graduate"
    return {"hours": hours, "division": division}


def parse_prereq(html_frag: str):
    """Extract prerequisite sentence(s) and a best-effort AST.

    Returns (text, ast, confidence) — ast is None when no course anchors
    appear or the connective structure is ambiguous.
    """
    m = re.search(r"Prerequisite[s]?:?(.*?)(?:</p>|$)", html_frag, re.S | re.I)
    if not m:
        return None, None, None
    frag = m.group(1)
    text = strip_tags(frag).rstrip(".") + "."
    # anchors: <a href="/search/?P=ECO%20304K" ... class="bubblelink" ...>
    tokens = []  # (pos, course_id) in order
    for am in re.finditer(r'<a[^>]*href="[^"]*[?&]P=([^"&]+)"[^>]*>(.*?)</a>', frag, re.S):
        cid = clean(am.group(1).replace("%20", " "))
        tokens.append((am.start(), cid, am.end()))
    if not tokens:
        return text, None, "none"

    # Build alternating [course, connective-text, course, ...]
    parts = []
    for i, (start, cid, end) in enumerate(tokens):
        parts.append(("course", cid))
        nxt = tokens[i + 1][0] if i + 1 < len(tokens) else len(frag)
        conn = strip_tags(frag[end:nxt]).lower()
        parts.append(("conn", conn))
    parts.pop()  # trailing connective belongs to prose, keep for grade scan
    tail = strip_tags(frag[tokens[-1][2]:]).lower()

    def grade_in(s):
        g = re.search(r"grade of at least ([a-d][+-]?)", s)
        return g.group(1).upper() if g else None

    # attach grades: "X with a grade of at least C-" attaches to previous
    # course; "each with a grade of at least C-" (in tail) attaches to all.
    nodes = []
    ops = []
    conf = "high"
    for kind, val in parts:
        if kind == "course":
            nodes.append({"type": "course", "id": val, "minGrade": None})
        else:
            g = grade_in(val)
            if g and nodes:
                nodes[-1]["minGrade"] = g
            has_and = bool(re.search(r"\band\b", val)) or val.strip().startswith(",")
            has_or = bool(re.search(r"\bor\b", val))
            if has_and and has_or:
                conf = "low"
                ops.append("mixed")
            elif has_or:
                ops.append("or")
            elif has_and or val.strip() in (",", ";", ""):
                ops.append("and")
            else:
                ops.append("and")
                if len(val) > 40:  # long prose between courses: structure unclear
                    conf = "low"
    tail_grade = grade_in(tail)
    if tail_grade:
        if "each" in tail or len(nodes) == 1:
            for n in nodes:
                n["minGrade"] = n["minGrade"] or tail_grade
        else:
            nodes[-1]["minGrade"] = nodes[-1]["minGrade"] or tail_grade
    for n in nodes:
        if n["minGrade"] is None:
            del n["minGrade"]

    if len(nodes) == 1:
        ast = nodes[0]
    elif conf == "low" or "mixed" in ops:
        ast = None
        conf = "low"
    else:
        # comma-lists: "A, B, and C" => and-chain; "A, B, or C" => or-chain.
        # An explicit or/and anywhere in a pure comma chain sets the op.
        real = [o for o in ops if o in ("and", "or")]
        op = "or" if "or" in real and "and" not in real else None
        if op is None:
            op = "and" if "or" not in real else None
        if op is None:
            ast, conf = None, "low"
        else:
            ast = {"type": "all" if op == "and" else "any", "of": nodes}
    return text, ast, conf


SENT_PATTERNS = {
    "sameAs": re.compile(r"Same as ([^.]+)\."),
    "restricted": re.compile(r"(Restricted to [^.]+\.)"),
    "excluded": re.compile(r"May not be counted (?:by students with credit for|toward) ([^.]+)\."),
    "offering": re.compile(r"(Offered (?:in|on|during) [^.]+\.|Offered [a-z ]*only\.)"),
}


def parse_subject_page(path: Path):
    s = path.read_text(errors="replace")
    hm = re.search(r"<h3[^>]*>(.*?)</h3>", s, re.S)
    if not hm:
        return None
    head = strip_tags(hm.group(1))
    m = re.match(r"^(.*):\s*([A-Z &\-']{1,6})$", head)
    if not m:
        return None
    subj_name, subj_code = m.group(1).strip(), m.group(2).strip()

    courses = []
    blocks = re.findall(r"<h5>(.*?)</h5>\s*<p>(.*?)</p>", s, re.S)
    for rawtitle, body in blocks:
        title = clean(rawtitle)
        tm = re.match(
            r"^(?P<subj>.+?)\s(?P<nums>\d[0-9A-Z]*(?:,\s*\d[0-9A-Z]*)*"
            r"(?:,?\s+(?:and\s+)?\d[0-9A-Z]*)?)"
            r"(?:\s*\(TCCN[:]?\s*(?P<tccn>[^)]+)\))?"
            r"\.\s*(?P<name>.+?)\.?$",
            title,
        )
        if not tm or clean(tm.group("subj")) != subj_code:
            continue
        nums = [n.strip() for n in re.split(r",|\band\b", tm.group("nums")) if n.strip()]
        desc = strip_tags(body)
        prereq_text, prereq_ast, prereq_conf = parse_prereq(body)
        extra = {}
        for key, pat in SENT_PATTERNS.items():
            sm = pat.search(desc)
            if sm:
                extra[key] = sm.group(1).strip()
        # six-hour courses are taken as two three-hour halves recorded as
        # <num>A / <num>B (e.g. PHL 610QA/610QB, T C 660HA/660HB); the
        # catalog lists only the base number, so synthesize both halves
        expanded = list(nums)
        for num in nums:
            if num.startswith("6") and not num[-1] in "AB" and COURSE_NUM.match(num):
                expanded += [f"{num}A", f"{num}B"]
        for num in expanded:
            meta = number_meta(num)
            if not meta:
                continue
            c = {
                "id": f"{subj_code} {num}",
                "subject": subj_code,
                "number": num,
                "title": tm.group("name").strip(),
                "hours": meta["hours"],
                "division": meta["division"],
                "description": desc,
            }
            if tm.group("tccn"):
                c["tccn"] = clean(tm.group("tccn"))
            if prereq_text:
                c["prereqText"] = prereq_text
                if prereq_ast:
                    c["prereq"] = prereq_ast
                c["prereqConfidence"] = prereq_conf
            c.update(extra)
            courses.append(c)
    return {"code": subj_code, "name": subj_name, "slug": path.stem.split("__")[-1], "courses": courses}


def run(edition: str) -> None:
    cache = HERE / "cache" / edition
    outdir = DATA / edition / "courses"
    outdir.mkdir(parents=True, exist_ok=True)
    index = []
    total = 0
    low_conf = 0
    with_prereq = 0
    for path in sorted(cache.glob("general-information__coursesatoz__*.html")):
        parsed = parse_subject_page(path)
        if not parsed or not parsed["courses"]:
            continue
        (outdir / f"{parsed['slug']}.json").write_text(
            json.dumps({k: parsed[k] for k in ("code", "name", "courses")},
                       indent=0, ensure_ascii=False))
        index.append({"code": parsed["code"], "name": parsed["name"],
                      "slug": parsed["slug"], "count": len(parsed["courses"])})
        total += len(parsed["courses"])
        for c in parsed["courses"]:
            if "prereqText" in c:
                with_prereq += 1
                if c.get("prereqConfidence") == "low":
                    low_conf += 1
    (DATA / edition / "courses-index.json").write_text(
        json.dumps({"edition": edition, "subjects": index, "totalCourses": total},
                   indent=1, ensure_ascii=False))
    print(f"[{edition}] {len(index)} subjects, {total} courses, "
          f"{with_prereq} with prereqs ({low_conf} low-confidence ASTs)")


if __name__ == "__main__":
    for ed in (sys.argv[1:] or ["2024-26", "2022-24"]):
        run(ed)
