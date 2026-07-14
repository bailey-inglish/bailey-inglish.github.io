#!/usr/bin/env python3
"""Scrape the College of Liberal Arts' published "Core and Liberal Arts Area
Courses" PDFs into named, reusable course lists.

These area lists (Social Science, Cultural Expression/Human Experience/
Thought, etc.) are the authoritative approved-course lists that the catalog
only points to ("a list of approved courses is available ... on the College
of Liberal Arts website"). They are shared across every COLA BA Plan I major
via the shared degree layer, so encoding them once fixes them everywhere.

Emits data/<edition>/lists.json = { "<list-id>": ["AFR 303", ...] }.

Usage: python3 scrape_lists.py
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE.parent / "data"
CACHE = HERE / "cache" / "lists"
UA = "bailey-inglish.github.io degree-planner dataset builder (contact: inglish@utexas.edu)"

# Which published PDF applies to which catalog edition. The academic-year
# lists are updated yearly; each maps to the edition a student under it uses.
SOURCES = {
    "2024-26": "https://minio.la.utexas.edu/webeditor-files/Core and Liberal Arts Area Courses for Fall 2024 - Summer 2025.pdf",
    "2022-24": "https://minio.la.utexas.edu/webeditor-files/Core and Liberal Arts Area Courses for Fall 2023 - Summer 2024.pdf",
}

# Target area -> list id, located by a distinctive anchor phrase. The body
# runs from the anchor to the next area boundary (BOUNDARIES below).
AREAS = [
    ("Additional Social Science", "cola-social-science"),
    ("Cultural Expression", "cola-cultural-expression"),
    ("Additional Natural Science", "cola-natural-science"),
]

# Every phrase that starts a new area section — used to bound each area's
# body so a list can't bleed into the next section.
BOUNDARIES = [
    "First-Year Signature", "Composition", "Humanities",
    "American & Texas Government", "United States History",
    "Social & Behavioral", "Mathematics (Core", "Natural Science and",
    "Visual & Performing", "Foreign Language", "Additional Social Science",
    "Additional Natural Science", "Cultural Expression", "Quantitative",
    "ROTC",
]

# "Subject Name (CODE): 303, 315O, 322D" -> subject code + number list.
# Codes are 1-4 letters, optionally spaced ("E", "AFR", "C S", "C C").
SUBJECT_RE = re.compile(r"\(([A-Z](?:[A-Z ]{0,4}[A-Z])?)\):\s*([0-9][0-9A-Z,&§\s]*)")


def fetch_pdf(edition: str, url: str) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{edition}.pdf"
    if not path.exists():
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=90) as resp:
            path.write_bytes(resp.read())
    return path.read_bytes()


def pdf_text(data: bytes, edition: str) -> str:
    from pypdf import PdfReader
    import io
    reader = PdfReader(io.BytesIO(data))
    return "\n".join(p.extract_text() or "" for p in reader.pages)


def parse_courses(body: str, known: set[str]) -> list[str]:
    ids: list[str] = []
    for m in SUBJECT_RE.finditer(body):
        subj = m.group(1).strip()
        nums = m.group(2)
        # stop the number run at the next subject "(" or a sentence break
        nums = re.split(r"[.;]| [A-Z][a-z]", nums)[0]
        for tok in re.split(r"[,\s]+", nums):
            tok = tok.strip(" &§")
            if re.fullmatch(r"\d[0-9A-Z]*", tok):
                cid = f"{subj} {tok}"
                if cid in known and cid not in ids:
                    ids.append(cid)
    return ids


def boundary_offsets(text: str) -> list[int]:
    offs = set()
    for b in BOUNDARIES:
        offs.update(m.start() for m in re.finditer(re.escape(b), text))
    offs.add(len(text))
    return sorted(offs)


def area_body(text: str, anchor: str, boundaries: list[int]) -> str | None:
    m = re.search(re.escape(anchor), text)
    if not m:
        return None
    start = m.end()
    end = next((b for b in boundaries if b > start), len(text))
    return text[start:end]


def load_known(edition: str) -> set[str]:
    known = set()
    for f in (DATA / edition / "courses").glob("*.json"):
        for c in json.loads(f.read_text())["courses"]:
            known.add(c["id"])
    return known


def run(edition: str, url: str) -> None:
    known = load_known(edition)
    text = pdf_text(fetch_pdf(edition, url), edition)
    boundaries = boundary_offsets(text)
    lists: dict[str, list[str]] = {}
    for anchor, list_id in AREAS:
        body = area_body(text, anchor, boundaries)
        if body is None:
            continue
        lists.setdefault(list_id, [])
        for cid in parse_courses(body, known):
            if cid not in lists[list_id]:
                lists[list_id].append(cid)
    out = {k: sorted(v) for k, v in lists.items() if v}
    (DATA / edition / "lists.json").write_text(
        json.dumps({"edition": edition, "source": url, "lists": out},
                   indent=1, ensure_ascii=False))
    summary = ", ".join(f"{k}={len(v)}" for k, v in out.items())
    print(f"[{edition}] lists: {summary}")


if __name__ == "__main__":
    for ed in (sys.argv[1:] or list(SOURCES)):
        run(ed, SOURCES[ed])
