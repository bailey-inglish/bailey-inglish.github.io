#!/usr/bin/env python3
"""Scrape UT Austin catalog pages into a local cache.

Downloads the courses A-Z subject pages (and any explicitly listed program
pages) for each catalog edition in editions.json. Cached HTML is the input to
parse_courses.py and program extraction; it is not committed to the repo.

Usage:
  python3 scrape.py courses [edition ...]
  python3 scrape.py pages <edition> <path> [<path> ...]
"""
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
CACHE = HERE / "cache"
EDITIONS = json.loads((HERE / "editions.json").read_text())
DELAY_SECONDS = 0.4
UA = "bailey-inglish.github.io degree-planner dataset builder (contact: inglish@utexas.edu)"


def fetch(url: str, retries: int = 4) -> str:
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except (urllib.error.URLError, OSError):
            if attempt == retries:
                raise
            time.sleep(2 ** (attempt + 1))


def cache_path(edition: str, rel: str) -> Path:
    slug = rel.strip("/").replace("/", "__") or "index"
    return CACHE / edition / f"{slug}.html"


def fetch_cached(edition: str, rel: str, force: bool = False) -> str:
    path = cache_path(edition, rel)
    if path.exists() and not force:
        return path.read_text()
    url = EDITIONS[edition]["base"] + rel
    html = fetch(url)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html)
    time.sleep(DELAY_SECONDS)
    return html


def scrape_courses(edition: str) -> None:
    index = fetch_cached(edition, "/general-information/coursesatoz/")
    subjects = sorted(set(re.findall(
        r'href="[^"]*/coursesatoz/([a-z0-9-]+)/"', index)))
    print(f"[{edition}] {len(subjects)} subject pages")
    for i, subj in enumerate(subjects):
        fetch_cached(edition, f"/general-information/coursesatoz/{subj}/")
        if (i + 1) % 25 == 0:
            print(f"[{edition}] {i + 1}/{len(subjects)}")
    print(f"[{edition}] done")


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "courses"
    if cmd == "courses":
        editions = sys.argv[2:] or list(EDITIONS)
        for ed in editions:
            scrape_courses(ed)
    elif cmd == "pages":
        edition = sys.argv[2]
        for rel in sys.argv[3:]:
            fetch_cached(edition, rel)
            print(f"[{edition}] cached {rel}")
    else:
        sys.exit(f"unknown command: {cmd}")


if __name__ == "__main__":
    main()
