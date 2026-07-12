#!/usr/bin/env python3
"""Dump a cached catalog page's main content as clean annotated text.

Used during program extraction: headings are marked with #, course links
are resolved to canonical ids in [brackets], everything else is verbatim
catalog prose — so requirement rules can be encoded (and their `source`
quotes taken) directly from this dump.

Usage: python3 dump_page.py <edition> <relative-path>
"""
import html as htmllib
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent


def dump(edition: str, rel: str) -> str:
    slug = rel.strip("/").replace("/", "__") or "index"
    path = HERE / "cache" / edition / f"{slug}.html"
    s = path.read_text(errors="replace")
    m = re.search(r'<div[^>]*id="textcontainer".*', s, re.S)
    body = m.group(0) if m else s
    # resolve course bubblelinks to canonical ids
    body = re.sub(
        r'<a[^>]*href="[^"]*[?&]P=([^"&]+)"[^>]*>(.*?)</a>',
        lambda mo: f"{re.sub(r'<[^>]+>', '', mo.group(2))} [{htmllib.unescape(mo.group(1).replace('%20', ' '))}]",
        body,
    )
    body = re.sub(r"<(h[2-6])[^>]*>", lambda mo: f"\n\n{'#' * int(mo.group(1)[1])} ", body)
    body = re.sub(r"<t[dh][^>]*>", " | ", body)
    body = re.sub(r"<tr[^>]*>", "\n", body)
    body = re.sub(r"<(p|li|div|table|ul|ol)[^>]*>", "\n", body)
    body = re.sub(r"<[^>]+>", "", body)
    body = htmllib.unescape(body).replace(" ", " ").replace("​", "")
    lines = [re.sub(r"[ \t]+", " ", l).strip() for l in body.split("\n")]
    out = []
    for l in lines:
        if l or (out and out[-1]):
            out.append(l)
    text = "\n".join(out)
    # cut the footer
    text = re.split(r"\n[^\n]*Our mission is to create, maintain", text)[0]
    return text.strip()


if __name__ == "__main__":
    print(dump(sys.argv[1], sys.argv[2]))
