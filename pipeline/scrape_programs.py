#!/usr/bin/env python3
"""Fetch every college's program pages for the given editions: the
degrees-and-programs index, every degree page (+ suggested arrangements),
and the minor-and-certificate-programs page.

Usage: python3 scrape_programs.py [edition ...]
"""
import re
import sys
import urllib.error

from scrape import EDITIONS, fetch_cached, cache_path

COLLEGES = [
    "architecture", "business", "civic-leadership", "communication",
    "education", "engineering", "fine-arts", "geosciences", "information",
    "liberal-arts", "natural-sciences", "nursing", "pharmacy",
    "public-affairs", "social-work", "undergraduate-studies",
    "undergraduate-college",
]


def get(edition: str, rel: str) -> str | None:
    try:
        return fetch_cached(edition, rel)
    except urllib.error.HTTPError as e:
        print(f"[{edition}] MISS {e.code} {rel}")
        return None


def run(edition: str) -> None:
    degree_pages: set[str] = set()
    for college in COLLEGES:
        index = get(edition, f"/undergraduate/{college}/degrees-and-programs/")
        get(edition, f"/undergraduate/{college}/minor-and-certificate-programs/")
        get(edition, f"/undergraduate/{college}/graduation/")
        if not index:
            continue
        # degree pages for THIS college only (nav links cover all colleges,
        # but the archive prefixes hrefs with /archive/<year>)
        pat = rf'href="(?:/archive/[0-9-]+)?(/undergraduate/{college}/degrees-and-programs/[^"#]+)"'
        for rel in set(re.findall(pat, index)):
            if rel.endswith(".pdf"):
                continue
            degree_pages.add(rel)
    print(f"[{edition}] {len(degree_pages)} degree pages to fetch")
    done = 0
    for rel in sorted(degree_pages):
        was_cached = cache_path(edition, rel).exists()
        get(edition, rel)
        done += 1
        if not was_cached and done % 50 == 0:
            print(f"[{edition}] {done}/{len(degree_pages)}")
    print(f"[{edition}] done")


if __name__ == "__main__":
    for ed in (sys.argv[1:] or ["2024-26", "2022-24"]):
        if ed not in EDITIONS:
            sys.exit(f"unknown edition {ed}")
        run(ed)
