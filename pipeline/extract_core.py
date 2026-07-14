#!/usr/bin/env python3
"""Generate the university core curriculum layer program from the General
Information catalog's core-curriculum page (which carries the complete
approved course list per component, resolvable to canonical ids).

Usage: python3 extract_core.py [edition ...]
"""
import json
import re
import sys
from pathlib import Path

from dump_page import dump

HERE = Path(__file__).parent
DATA = HERE.parent / "data"

PAGE = "/general-information/academic-policies-and-procedures/core-curriculum/"
CID = re.compile(r"\[([A-Z][A-Z &\-']{0,5} \d[0-9A-Z]*)\]")

# (code, display name, hours, header-match pattern) — older editions title
# sections by name only, newer ones append "Texas Core Code NNN"
COMPONENTS = [
    ("090", "First-Year Signature Course", 3, r"Signature Course"),
    ("010", "Communication", 6, r"Communication|English Composition"),
    ("040", "Humanities", 3, r"Humanities"),
    ("070", "American and Texas Government", 6, r"Government"),
    ("060", "U.S. History", 6, r"History"),
    ("080", "Social and Behavioral Sciences", 3, r"Social and Behavioral"),
    ("020", "Mathematics", 3, r"Mathematics"),
    ("030", "Natural Science and Technology, Part I", 6, r"Part I\b"),
    ("093", "Natural Science and Technology, Part II", 3, r"Part II"),
    ("050", "Visual and Performing Arts", 3, r"Visual and Performing"),
]


def base_url(edition: str) -> str:
    editions = json.loads((HERE / "editions.json").read_text())
    return editions[edition]["base"] + PAGE


def extract(edition: str) -> dict:
    text = dump(edition, PAGE)
    sections = re.split(r"\n### ", text)

    def find_section(pattern: str) -> str | None:
        for sec in sections[1:]:
            if re.search(pattern, sec.split("\n")[0]):
                return sec
        return None

    url = base_url(edition)
    children = []
    part1_ids: list[str] = []
    for code, name, hrs, pattern in COMPONENTS:
        sec = find_section(pattern)
        if not sec:
            raise SystemExit(f"[{edition}] missing core component {code} ({name})")
        ids = list(dict.fromkeys(CID.findall(sec)))
        title = f"{name} (core {code})"
        src = {"url": url, "quote": sec.split("\n")[0].strip()}
        if code == "010":
            # first group is the required composition course; the rest is
            # either an explicit second-course list (2024-26) or a
            # Writing-Flag course with no static list (2022-24 and earlier)
            head, _, tail = sec.partition("chosen from:")
            comp_ids = list(dict.fromkeys(CID.findall(head)))
            rest_ids = [i for i in dict.fromkeys(CID.findall(tail)) if i not in comp_ids]
            second: dict
            if rest_ids:
                second = {"type": "hours", "hours": 3, "title": "Second communication course",
                          "filter": {"courses": rest_ids, "label": "Communication (core 010)"},
                          "minGrade": "D-"}
            else:
                # older editions listed the second course only by a Writing
                # Flag designation (flags since abolished) with no course list
                second = {"type": "note", "title": "Second communication course",
                          "text": "A three-hour course with a Writing Flag designation."}
            children.append({
                "type": "all", "title": title, "id": f"core-{code}", "source": src,
                "of": [
                    {"type": "hours", "hours": 3, "title": "Composition",
                     "filter": {"courses": comp_ids, "label": "Composition (RHE 306 or equivalent)"},
                     "minGrade": "D-"},
                    second,
                ],
            })
            continue
        if code == "030":
            part1_ids = ids
        if code == "093":
            # an additional Part I course may fulfill Part II
            ids = list(dict.fromkeys(ids + part1_ids))
        children.append({
            "type": "hours", "hours": hrs, "title": title, "id": f"core-{code}",
            "source": src, "minGrade": "D-",
            "filter": {"courses": ids, "label": title},
        })

    return {
        "id": f"{edition}/layer/core-curriculum",
        "edition": edition,
        "type": "layer",
        "name": "University Core Curriculum",
        "college": "The University",
        "totalHours": 42,
        "sourceUrl": url,
        "notes": ("A single course may not be counted toward more than one core "
                  "component area. Core courses must be taken for a letter grade "
                  "(minimum D-). Government pairing rules for transfer credit are "
                  "stricter than shown here."),
        "rules": {"type": "all", "title": "Core Curriculum (42 hours)", "of": children},
    }


if __name__ == "__main__":
    for ed in (sys.argv[1:] or ["2024-26", "2022-24"]):
        prog = extract(ed)
        outdir = DATA / ed / "programs"
        outdir.mkdir(parents=True, exist_ok=True)
        (outdir / "core-curriculum.json").write_text(
            json.dumps(prog, indent=1, ensure_ascii=False))
        n = sum(1 for _ in json.dumps(prog))
        comp = len(prog["rules"]["of"])
        print(f"[{ed}] core layer: {comp} components, {n} bytes")
