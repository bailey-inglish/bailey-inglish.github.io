#!/usr/bin/env python3
"""Catalog-wide automatic program extraction.

Walks every college's cached pages and converts them into requirements-DSL
programs:

  - minor-and-certificate-programs pages: one <h3> section per minor or
    certificate, each built around CourseLeaf `sc_courselist` tables whose
    structure (comment rows carrying group hours, indented course rows,
    or-rows) maps cleanly onto `hours` / `anyN` / `course` nodes
  - degree pages: the same tables where present, plus prose paragraphs;
    prose that matches simple patterns becomes rule nodes, everything else
    becomes a verbatim `manual` node — visible in the UI, never dropped

Hand-curated encodings (extract_programs.py) always win: any program id
they produce is skipped here. Emits per-edition coverage stats.

Usage: python3 extract_auto.py [edition ...]
"""
import html as htmllib
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE.parent / "data"
CACHE = HERE / "cache"
EDITIONS = json.loads((HERE / "editions.json").read_text())

COLLEGES = {
    "architecture": "Architecture",
    "business": "Business",
    "civic-leadership": "Civic Leadership",
    "communication": "Communication",
    "education": "Education",
    "engineering": "Engineering",
    "fine-arts": "Fine Arts",
    "geosciences": "Geosciences",
    "information": "Information",
    "liberal-arts": "Liberal Arts",
    "natural-sciences": "Natural Sciences",
    "nursing": "Nursing",
    "pharmacy": "Pharmacy",
    "public-affairs": "Public Affairs",
    "social-work": "Social Work",
    "undergraduate-studies": "Undergraduate Studies",
    "undergraduate-college": "Undergraduate College",
}

BUBBLE = re.compile(
    r'<a[^>]*href="[^"]*[?&]P=([^"&]+)"[^>]*class="bubblelink[^"]*"[^>]*>')


def clean(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s)
    s = htmllib.unescape(s).replace(" ", " ").replace("​", "")
    return re.sub(r"\s+", " ", s).strip()


def course_ids_in(frag: str) -> list[str]:
    return [htmllib.unescape(m.group(1).replace("%20", " "))
            for m in BUBBLE.finditer(frag)]


# ---------- sc_courselist table parsing ----------

def parse_table(table_html: str) -> list[dict]:
    """rows: {kind: comment|course|orcourse, text, id, title, hours, indent}"""
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", table_html, re.S):
        orclass = 'orclass' in tr[:200] or bool(re.match(r'\s*<td[^>]*>\s*or\b', clean(tr)[:3].lower()))
        hours_m = re.search(r'<td class="hourscol">([^<]*)</td>', tr)
        hours = None
        if hours_m:
            hm = re.search(r"[\d.]+", hours_m.group(1))
            if hm:
                hours = float(hm.group(0))
        comment = re.search(r'<span class="courselistcomment[^"]*">(.*?)</span>', tr, re.S)
        ids = course_ids_in(tr)
        indent = "margin-left" in tr
        if re.search(r'class="listsum"', tr) or "Total Hours" in tr:
            rows.append({"kind": "total", "hours": hours})
        elif ids:
            title_m = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
            title = clean(title_m[1]) if len(title_m) > 1 else ""
            rows.append({"kind": "orcourse" if ("orclass" in tr) else "course",
                         "ids": ids, "title": title, "hours": hours,
                         "indent": indent})
        elif comment:
            rows.append({"kind": "comment", "text": clean(comment.group(1)),
                         "hours": hours, "area": "areaheader" in tr})
    return rows


WORD_N = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6}


def rules_from_table(rows: list[dict], url: str, min_grade: str | None,
                     known: set[str]) -> tuple[list[dict], float | None]:
    """Convert parsed rows into DSL nodes. Returns (nodes, totalHours)."""
    nodes: list[dict] = []
    total_hours = None
    group: dict | None = None

    def close_group():
        nonlocal group
        if not group:
            return
        ids = [i for i in group["ids"] if i in known]
        node: dict
        if not ids:
            node = {"type": "manual", "text": group["text"],
                    "title": group["text"][:80]}
        else:
            m = re.match(r"(One|Two|Three|Four|Five|Six)\s+of the following",
                         group["text"], re.I)
            if m and group["hours"] and group["hours"] <= 6 and len(ids) > 1:
                n = WORD_N[m.group(1).lower()]
                node = {"type": "anyN", "n": min(n, len(ids)),
                        "title": group["text"][:80],
                        "of": [{"type": "course", "course": i,
                                **({"minGrade": min_grade} if min_grade else {})}
                               for i in ids]}
            else:
                node = {"type": "hours",
                        "hours": group["hours"] or sum_hours(ids),
                        "title": group["text"][:80],
                        "filter": {"courses": ids, "label": group["text"][:80]}}
                if min_grade:
                    node["minGrade"] = min_grade
        node["source"] = {"url": url, "quote": group["text"]}
        nodes.append(node)
        group = None

    def sum_hours(ids: list[str]) -> float:
        # fallback group size when the hours cell was empty
        return float(len(ids) * 3)

    for row in rows:
        if row["kind"] == "total":
            if row.get("hours"):
                total_hours = row["hours"]
            continue
        if row["kind"] == "comment":
            if row.get("area") or re.search(r"\(Core\)", row["text"]):
                close_group()
                continue
            if row.get("hours"):
                close_group()
                group = {"text": row["text"], "hours": row["hours"], "ids": []}
            elif group:
                pass  # sub-area label inside a group ("Statistics") — ignore
            elif not row["text"].rstrip().endswith(":"):
                # a comment header ending in ':' introduces following groups;
                # only free-standing prose becomes a manual item
                nodes.append({"type": "manual", "text": row["text"],
                              "title": row["text"][:80],
                              "source": {"url": url, "quote": row["text"]}})
            continue
        # course / orcourse rows
        ids = row["ids"]
        if group is not None and (row["indent"] or row["kind"] == "orcourse"):
            group["ids"] += ids
        elif group is not None and not row["indent"]:
            # a top-level course after a group ends the group
            close_group()
            nodes.append(course_node(ids, row, url, min_grade, known))
        else:
            if row["kind"] == "orcourse" and nodes and nodes[-1]["type"] in ("course", "anyN"):
                prev = nodes.pop()
                prev_courses = ([prev] if prev["type"] == "course" else prev["of"])
                alts = prev_courses + [
                    {"type": "course", "course": i,
                     **({"minGrade": min_grade} if min_grade else {})}
                    for i in ids if i in known]
                nodes.append({"type": "anyN", "n": 1,
                              "title": prev.get("title"),
                              "of": alts,
                              "source": prev.get("source", {"url": url})})
            else:
                nodes.append(course_node(ids, row, url, min_grade, known))
    close_group()
    return [n for n in nodes if n], total_hours


def course_node(ids: list[str], row: dict, url: str, min_grade: str | None,
                known: set[str]) -> dict | None:
    ids = [i for i in ids if i in known]
    if not ids:
        return None
    if len(ids) == 1:
        node: dict = {"type": "course", "course": ids[0]}
        if min_grade:
            node["minGrade"] = min_grade
    else:
        # several ids in one row = "A and B" pairing; require all
        node = {"type": "all", "title": row.get("title") or " + ".join(ids),
                "of": [{"type": "course", "course": i,
                        **({"minGrade": min_grade} if min_grade else {})}
                       for i in ids]}
    if row.get("title"):
        node.setdefault("title", None)
        node["title"] = f"{' / '.join(ids)}"
    node["source"] = {"url": url}
    return node


# ---------- prose handling (degree pages) ----------

SKIP_PROSE = re.compile(
    r"(core curriculum|skills and experience flags|general requirements for "
    r"graduation|suggested arrangement|academic advisor|apply for admission|"
    r"first-year interest group|www\\.|http|placed on (academic )?warning|"
    r"dismissed|may not register for more|no student may register|"
    r"must first be admitted|dual degree|transfer student|pass/fail basis "
    r"only|petition)", re.I)

REQ_HINT = re.compile(r"(hours|grade|must|required|complete)", re.I)

ONES = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
        "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11,
        "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
        "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19}
TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60}


def word_to_num(w: str) -> int | None:
    w = w.lower().strip()
    if w.isdigit():
        return int(w)
    if w in ONES:
        return ONES[w]
    parts = w.split("-")
    if parts[0] in TENS:
        n = TENS[parts[0]]
        if len(parts) == 2 and parts[1] in ONES:
            n += ONES[parts[1]]
        return n
    return None


NUM_WORD = r"[A-Za-z]+(?:-[a-z]+)?|\d+"


def hours_of_subject(text: str, subject_map: dict[str, str], url: str):
    """'Thirty semester hours of history, at least 15 of which must be
    upper-division' -> umbrella hours nodes with a subjects filter."""
    # total-hours rule: "Enough additional coursework to make a total of
    # 120 semester hours"
    tm = re.search(r"total of ({NUM}) (?:semester )?hours".replace("{NUM}", NUM_WORD), text, re.I)
    if tm and "coursework" in text.lower():
        n = word_to_num(tm.group(1))
        if n and n >= 100:
            return [{
                "type": "hours", "hours": float(n), "umbrella": True,
                "title": f"{n} total hours",
                "filter": {"label": "Any coursework"},
                "source": {"url": url, "quote": text[:200]},
            }], None
    # upper-division coursework rule, with optional subject and residency:
    # "At least 21 semester hours of upper-division coursework in computer
    # science must be completed in residence"
    um = re.match(
        rf"(?:At least )?({NUM_WORD}) (?:additional )?(?:semester )?hours? of "
        rf"upper.division (?:coursework|courses)"
        rf"(?: (?:in|must be in) ([a-z][a-z ,&-]{{2,40}}?))?(?:[,.]|$| must| that| chosen)",
        text, re.I)
    if um:
        n = word_to_num(um.group(1))
        subj_name = (um.group(2) or "").strip().lower()
        code = subject_map.get(subj_name) if subj_name else None
        if n and (code or not subj_name):
            node = {
                "type": "hours", "hours": float(n), "umbrella": True,
                "title": f"{n} upper-division hours" + (f" of {subj_name}" if code else ""),
                "filter": {"division": "upper",
                           **({"subjects": [code]} if code else {}),
                           "label": f"Upper-division {subj_name or 'coursework'}"},
                "source": {"url": url, "quote": text[:200]},
            }
            if re.search(r"in residence", text, re.I):
                node["inResidence"] = True
            return [node], code
    m = re.match(
        rf"(?:At least )?({NUM_WORD}) (?:semester )?hours? (?:of|in) "
        rf"(?:coursework in )?([a-z][a-z ,&-]{{2,40}}?)(?:[,.]| including| at least)",
        text, re.I)
    if not m:
        return None
    n = word_to_num(m.group(1))
    subj_name = m.group(2).strip().lower()
    code = subject_map.get(subj_name)
    if not n or not code or n < 12:
        return None
    nodes = [{
        "type": "hours", "hours": float(n), "umbrella": True,
        "title": f"{n} hours of {subj_name}",
        "filter": {"subjects": [code], "label": f"{subj_name.title()} coursework"},
        "source": {"url": url, "quote": text[:200]},
    }]
    up = re.search(
        rf"at least ({NUM_WORD})(?: hours| semester hours)?(?: of which)? "
        rf"(?:hours )?(?:must be|in) (?:in )?upper.division", text, re.I)
    if up:
        u = word_to_num(up.group(1))
        if u:
            nodes.append({
                "type": "hours", "hours": float(u), "umbrella": True,
                "title": f"{u} upper-division hours of {subj_name}",
                "filter": {"subjects": [code], "division": "upper",
                           "label": f"Upper-division {subj_name}"},
                "source": {"url": url, "quote": text[:200]},
            })
    return nodes, code


def connective_node(frag_html: str, text: str, ids: list[str], url: str,
                    min_grade: str | None):
    """Short list item like 'Mathematics 408C and 408D' or 'C S 429 or
    429H' -> all/anyN node; mixed connectives -> None."""
    if not ids or len(text) > 220:
        return None
    stripped = re.sub(r"\[[A-Z][A-Z &\-']{0,5} \d[0-9A-Z]*\]", "", text)
    stripped = re.sub(r"[A-Z][a-zA-Z ]*? \d[0-9A-Z]*", "", stripped)
    words = set(re.findall(r"[a-z]+", stripped.lower()))
    connectives = words & {"and", "or"}
    grade = re.search(r"grade of at least (?:an? )?([A-D][+-]?)(?![\w+-])", text)
    mg = grade.group(1).upper() if grade else min_grade
    leftover = words - {"and", "or", "a", "an", "the", "of", "at", "least",
                        "grade", "with", "in", "each", "must", "be",
                        "completed", "residence", "semester", "hours", "hour",
                        "chosen", "from", "one", "following", "course",
                        "courses", "credit", "either", "both", "student",
                        "students", "s"}
    course_nodes = [{"type": "course", "course": i,
                     **({"minGrade": mg} if mg else {})} for i in ids]
    if len(ids) == 1 and len(leftover) <= 3:
        node = course_nodes[0]
        node["source"] = {"url": url, "quote": text[:200]}
        return node
    if len(leftover) > 4:
        return None
    if connectives == {"or"}:
        return {"type": "anyN", "n": 1, "title": text[:90], "of": course_nodes,
                "source": {"url": url, "quote": text[:200]}}
    if connectives <= {"and"}:
        return {"type": "all", "title": text[:90], "of": course_nodes,
                "source": {"url": url, "quote": text[:200]}}
    return None


def prose_nodes(fragments: list[str], url: str, known: set[str],
                subject_map: dict[str, str]):
    nodes = []
    subjects_seen: list[str] = []
    for frag in fragments:
        text = clean(frag)
        if len(text) < 12 or SKIP_PROSE.search(text):
            continue
        ids = [i for i in course_ids_in(frag) if i in known]
        # keyword gate only applies to prose without any course references
        if not ids and (len(text) < 25 or not REQ_HINT.search(text)):
            continue
        if text.rstrip().endswith(":") and len(text) < 90 and not ids:
            continue  # header introducing a following list

        hos = hours_of_subject(text, subject_map, url)
        if hos:
            hnodes, code = hos
            nodes += hnodes
            if code:
                subjects_seen.append(code)
            # keep the detail as manual when named courses follow
            if ids:
                nodes.append({"type": "manual", "text": text,
                              "title": "Specific courses within: " + hnodes[0]["title"],
                              "source": {"url": url, "quote": text[:200]}})
            continue
        cn = connective_node(frag, text, ids, url, None)
        if cn:
            nodes.append(cn)
            continue
        nodes.append({"type": "manual", "text": text,
                      "title": text[:80],
                      "source": {"url": url, "quote": text[:200]}})
    return nodes, subjects_seen


# ---------- page-level extraction ----------

def textcontainer(path: Path) -> str | None:
    if not path.exists():
        return None
    s = path.read_text(errors="replace")
    m = re.search(r'<div[^>]*id="textcontainer"(.*?)(?:<footer|<div id="rightbar")', s, re.S)
    return m.group(1) if m else None


def page_url(edition: str, rel: str) -> str:
    return EDITIONS[edition]["base"] + rel


def slugify(name: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", name.lower())).strip("-")


def min_grade_in(text: str) -> str | None:
    m = re.search(r"grade of at least (?:an? )?([A-D][+-]?)(?![\w+-])", text)
    return m.group(1).upper() if m else None


def extract_minor_cert_page(edition: str, college: str, known: set[str]) -> list[dict]:
    rel = f"/undergraduate/{college}/minor-and-certificate-programs/"
    body = textcontainer(CACHE / edition / f"undergraduate__{college}__minor-and-certificate-programs.html")
    if not body:
        return []
    url = page_url(edition, rel)
    programs = []
    sections = re.split(r"<h3[^>]*>", body)
    for sec in sections[1:]:
        name_m = re.match(r"(.*?)</h3>", sec, re.S)
        if not name_m:
            continue
        name = clean(name_m.group(1))
        if re.search(r"^(Minors|Certificates)\b", name):
            continue  # section headers, not programs
        if re.search(r"Minor$", name):
            ptype = "minor"
        elif re.search(r"Certificate", name):
            ptype = "certificate"
        else:
            continue
        intro = clean(sec.split("<table", 1)[0])
        grade = min_grade_in(intro)
        nodes: list[dict] = []
        total = None
        for tbl in re.findall(r'<table class="sc_courselist".*?</table>', sec, re.S):
            tnodes, ttotal = rules_from_table(parse_table(tbl), url, grade, known)
            nodes += tnodes
            total = total or ttotal
        hours_m = re.search(r"(?:minimum of |requires |consists of a? ?(?:minimum of )?)(\d+)\s+(?:semester )?hours", intro)
        if not nodes:
            if not intro:
                continue
            nodes = [{"type": "manual", "text": intro[:600],
                      "title": "Requirements (see catalog)",
                      "source": {"url": url}}]
        short = re.sub(r"-(minor|certificate)$", "", slugify(name))
        prog = {
            "id": f"{edition}/{ptype}/{short}",
            "edition": edition, "type": ptype,
            "name": re.sub(r" (Minor|Certificate)$", "", name),
            "college": COLLEGES.get(college, college),
            "sourceUrl": url,
            "rules": {"type": "all", "title": name, "of": nodes},
            "auto": True,
        }
        if total or hours_m:
            prog["totalHours"] = total or float(hours_m.group(1))
        programs.append(prog)
    return programs


DEGREE_SLUG_RE = re.compile(
    r"/undergraduate/([a-z-]+)/degrees-and-programs/([a-z0-9-]+(?:/[a-z0-9-]+)?)/$")

HEADING_SECTIONS = re.compile(
    r"(?:Prescribed Work|Major Requirements|Curriculum|Degree Requirements|"
    r"Areas of Study|Requirements|Major)", re.I)


def degree_name(full_page: str, slug: str) -> str:
    h1 = re.search(r'<h1 class="page-title"[^>]*>(.*?)</h1>', full_page, re.S)
    name = clean(h1.group(1)) if h1 else ""
    if not name or name.lower() in ("university catalogs",):
        name = slug.split("/")[-1].replace("-", " ").title()
    return name


_SUBJECT_MAPS: dict[str, dict[str, str]] = {}


def subject_map_for(edition: str) -> dict[str, str]:
    if edition not in _SUBJECT_MAPS:
        idx = json.loads((DATA / edition / "courses-index.json").read_text())
        m = {}
        for sub in idx["subjects"]:
            m[sub["name"].lower()] = sub["code"]
        _SUBJECT_MAPS[edition] = m
    return _SUBJECT_MAPS[edition]


def infer_major_subjects(nodes: list[dict]) -> list[str]:
    counts: dict[str, int] = {}

    def walk(n):
        if n.get("type") == "course":
            subj = re.sub(r" \S+$", "", n["course"])
            counts[subj] = counts.get(subj, 0) + 1
        for ch in n.get("of", []):
            walk(ch)
        for cid in (n.get("filter", {}) or {}).get("courses", []):
            subj = re.sub(r" \S+$", "", cid)
            counts[subj] = counts.get(subj, 0) + 1

    for n in nodes:
        walk(n)
    if not counts:
        return []
    best = max(counts.items(), key=lambda kv: kv[1])
    return [best[0]] if best[1] >= 2 else []


def extract_degree_page(edition: str, college: str, rel: str,
                        known: set[str], curated_ids: set[str]) -> dict | None:
    m = DEGREE_SLUG_RE.match(rel)
    if not m:
        return None
    slug = m.group(2)
    if "suggested-arrangement" in rel or "/sugg-" in rel or slug.startswith("sugg-"):
        return None
    if "/" in slug:
        parent, leaf = slug.split("/", 1)
        if leaf.startswith("sugg"):
            return None
        prefix = {"bachelor-of-arts-plan-i": "ba",
                  "bachelor-of-science-and-arts": "bsa",
                  "bachelor-of-arts": "ba",
                  "bachelor-of-business-administration": "bba",
                  "bachelor-of-journalism": "bj",
                  "bachelor-of-music": "bm",
                  "bachelor-of-fine-arts": "bfa",
                  "bachelor-of-social-work": "bsw",
                  "bachelor-of-architecture": "barch"}.get(parent)
        slug = f"{prefix}-{leaf}" if prefix else f"{parent}-{leaf}"
    pid = f"{edition}/major/{slug}"
    if pid in curated_ids:
        return None
    cache_file = CACHE / edition / (rel.strip("/").replace("/", "__") + ".html")
    body = textcontainer(cache_file)
    if not body:
        return None
    url = page_url(edition, rel)

    NON_OPTION = re.compile(
        r"(special requirements|applying|admission|order of work|transfer|"
        r"minor|certificate|graduation)", re.I)

    def section_nodes(html_frag: str) -> tuple[list[dict], list[str]]:
        out: list[dict] = []
        for tbl in re.findall(r'<table class="sc_courselist".*?</table>', html_frag, re.S):
            tnodes, _ = rules_from_table(parse_table(tbl), url, None, known)
            out += tnodes
        wo_tables = re.sub(r"<table.*?</table>", "", html_frag, flags=re.S)
        fragments = re.findall(r"<(?:p|li)[^>]*>(.*?)</(?:p|li)>", wo_tables, re.S)
        pnodes, subs = prose_nodes(fragments, url, known, subject_map_for(edition))
        return out + pnodes, subs

    # split into a common part + named option sections at <h3>; when two or
    # more sections carry course requirements, students complete ONE of
    # them, so they become an anyN(1) of alternatives
    pieces = re.split(r"<h3[^>]*>(.*?)</h3>", body)
    common_html = pieces[0]
    options: list[tuple[str, str]] = []
    for i in range(1, len(pieces), 2):
        heading = clean(pieces[i])
        content = pieces[i + 1] if i + 1 < len(pieces) else ""
        if heading and not NON_OPTION.search(heading):
            options.append((heading, content))
        else:
            common_html += content
    nodes, subjects_seen = section_nodes(common_html)
    option_nodes = []
    for heading, content in options:
        onodes, osubs = section_nodes(content)
        if onodes:
            option_nodes.append({"type": "all", "title": heading, "of": onodes})
            subjects_seen += osubs
    if len(option_nodes) >= 2:
        nodes.append({"type": "anyN", "n": 1, "title": "One of the following options",
                      "of": option_nodes, "source": {"url": url}})
    elif option_nodes:
        nodes += option_nodes[0]["of"]

    # prose-thin pages (engineering-style): pull the curriculum from the
    # suggested-arrangement course table when few rules were extracted
    auto_nodes = [n for n in nodes if n.get("type") != "manual"]
    if len(auto_nodes) < 3:
        prefix = cache_file.name[:-len(".html")]
        for sib in cache_file.parent.glob(f"{prefix}__sugg*.html"):
            sbody = textcontainer(sib)
            if not sbody:
                continue
            snodes: list[dict] = []
            for tbl in re.findall(r'<table class="sc_courselist".*?</table>', sbody, re.S):
                tnodes, _ = rules_from_table(parse_table(tbl), url, None, known)
                snodes += tnodes
            snodes = [n for n in snodes if n.get("type") != "manual" or
                      "elective" in (n.get("text") or "").lower()]
            if snodes:
                nodes.append({"type": "all",
                              "title": "Curriculum (from suggested course arrangement)",
                              "of": snodes, "source": {"url": url}})
            break

    # drop exact-duplicate manual items (shared boilerplate across options)
    seen_texts: set[str] = set()
    deduped = []
    for n in nodes:
        key = n.get("text") or ""
        if n.get("type") == "manual":
            if key in seen_texts:
                continue
            seen_texts.add(key)
        deduped.append(n)
    nodes = deduped
    if not nodes:
        return None

    name = degree_name(cache_file.read_text(errors="replace"), slug)
    if name.startswith("Suggested Arrangement"):
        return None
    dt = re.match(r"(bsa|bs|ba|bba|bfa|bm|barch|bsw|bsn|bj)-", slug)
    degree_type = dt.group(1).upper() if dt else None
    includes = [f"{edition}/layer/core-curriculum", f"{edition}/layer/university-general"]
    if college == "liberal-arts" and "ba-" in slug and degree_type == "BA":
        includes.append(f"{edition}/layer/cola-ba-plan-i")
    if college == "natural-sciences":
        includes.append(f"{edition}/layer/cns-college")

    prog = {
        "id": pid,
        "edition": edition, "type": "major",
        "name": name,
        "college": COLLEGES.get(college, college),
        "sourceUrl": url,
        "includes": includes,
        "rules": {"type": "all", "title": "Requirements (auto-extracted)", "of": nodes},
        "auto": True,
        "notes": ("Auto-extracted from the catalog page; prose that could not "
                  "be formalized appears as manual-check items. Verify against "
                  "the linked catalog page."),
    }
    if degree_type:
        prog["degreeType"] = degree_type
    subjects_seen = [x for x in subjects_seen if x]
    ms = subjects_seen[:1] or infer_major_subjects(nodes)
    if ms:
        prog["majorSubjects"] = ms
    return prog


def load_known_courses(edition: str) -> set[str]:
    known = set()
    for f in (DATA / edition / "courses").glob("*.json"):
        for c in json.loads(f.read_text())["courses"]:
            known.add(c["id"])
    return known


def stats(nodes) -> tuple[int, int]:
    total = manual = 0

    def walk(n):
        nonlocal total, manual
        t = n.get("type")
        if t in ("course", "hours", "gpa", "anyN", "concentration", "manual"):
            total += 1
            if t == "manual":
                manual += 1
        for ch in n.get("of", []):
            if t not in ("anyN",):
                walk(ch)

    for n in nodes:
        walk(n)
    return total, manual


def run(edition: str) -> None:
    known = load_known_courses(edition)
    outdir = DATA / edition / "programs"
    outdir.mkdir(parents=True, exist_ok=True)
    curated_ids = set()
    for f in outdir.glob("*.json"):
        doc = json.loads(f.read_text())
        if not doc.get("auto"):
            curated_ids.add(doc["id"])
    # remove stale auto files before regeneration
    for f in outdir.glob("*.json"):
        if json.loads(f.read_text()).get("auto"):
            f.unlink()

    programs: list[dict] = []
    for college in COLLEGES:
        programs += extract_minor_cert_page(edition, college, known)
        index_file = CACHE / edition / f"undergraduate__{college}__degrees-and-programs.html"
        if not index_file.exists():
            continue
        idx = index_file.read_text(errors="replace")
        pat = rf'href="(?:/archive/[0-9-]+)?(/undergraduate/{college}/degrees-and-programs/[^"#]+/)"'
        rels = sorted(set(re.findall(pat, idx)))
        parents = {r for r in rels
                   if any(other != r and other.startswith(r) and
                          "sugg" not in other[len(r):] for other in rels)}
        for rel in rels:
            if rel in parents:
                continue
            p = extract_degree_page(edition, college, rel, known, curated_ids)
            if p:
                programs.append(p)

    # dedupe by id (nav overlap), curated wins
    seen: dict[str, dict] = {}
    for p in programs:
        if p["id"] in curated_ids or p["id"] in seen:
            continue
        seen[p["id"]] = p

    total_nodes = total_manual = 0
    for p in seen.values():
        slugname = p["id"].split("/", 1)[1].replace("/", "-")
        (outdir / f"{slugname}.json").write_text(
            json.dumps(p, indent=1, ensure_ascii=False))
        t, m_ = stats(p["rules"]["of"])
        total_nodes += t
        total_manual += m_

    by_type: dict[str, int] = {}
    for p in seen.values():
        by_type[p["type"]] = by_type.get(p["type"], 0) + 1
    print(f"[{edition}] auto-extracted {len(seen)} programs {by_type}; "
          f"{total_nodes} rule nodes, {total_manual} manual "
          f"({100 * total_manual / max(1, total_nodes):.0f}%)")

    rebuild_index(edition)


def rebuild_index(edition: str) -> None:
    outdir = DATA / edition / "programs"
    index = []
    for f in sorted(outdir.glob("*.json")):
        p = json.loads(f.read_text())
        index.append({"id": p["id"], "type": p["type"], "name": p["name"],
                      "college": p["college"],
                      **({"degreeType": p["degreeType"]} if p.get("degreeType") else {}),
                      **({"auto": True} if p.get("auto") else {}),
                      "file": f"programs/{f.name}"})
    (DATA / edition / "programs-index.json").write_text(
        json.dumps({"edition": edition, "programs": index}, indent=1,
                   ensure_ascii=False))
    print(f"[{edition}] index: {len(index)} programs")


if __name__ == "__main__":
    for ed in (sys.argv[1:] or ["2024-26", "2022-24"]):
        run(ed)
