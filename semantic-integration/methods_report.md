# Methods Report

## Overview
This dataset contains 100 semantic integration items built from open-source textbooks for early elementary readers. Each item includes:
- Stem 1: a definitional sentence with a quoted target term.
- Stem 2: a generic interaction sentence that uses the target term.
- Integration: a specific action sentence that replaces the target term with its definition.

## Sources Used
- Science Textbook Grade 2 (Macmillan/McGraw-Hill Education; ISBN 978-0-02-285999-2)
- Backpack Bear's Plant Book (Starfall Education Foundation; ISBN 978-1-59577-077-6)
- Backpack Bear's Mammal Book (Starfall Education Foundation; ISBN 978-1-59577-086-8)
- The Story of the World, Volume 3: Early Modern Times (Well-Trained Mind Press, 2019)
- Living in a Community (Core Knowledge Foundation, Grade 1, 2023)

## Text Extraction (PDF -> TXT)
PDF files were converted to text to support search and candidate review. The conversion script used `pdfminer.six`.

```python
import os
from pdfminer.high_level import extract_text

SRC_DIR = r"C:\Users\baile\Desktop\semantic-integration\textbooks_secondgrade"
OUT_DIR = r"C:\Users\baile\Desktop\semantic-integration\textbooks_secondgrade_txt"

os.makedirs(OUT_DIR, exist_ok=True)

pdfs = [f for f in os.listdir(SRC_DIR) if f.lower().endswith(".pdf")]
results = []
for name in pdfs:
    src_path = os.path.join(SRC_DIR, name)
    out_name = os.path.splitext(name)[0] + ".txt"
    out_path = os.path.join(OUT_DIR, out_name)
    try:
        text = extract_text(src_path) or ""
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(text)
        results.append((name, len(text)))
    except Exception as exc:
        results.append((name, f"ERROR: {exc}"))

print(results)
```

## Candidate Discovery (Reference Only)
Candidate sentences were pulled to speed manual review. This script produced a candidate list; final items were then manually edited.

```python
import os
import re

BASE_DIR = r"C:\Users\baile\Desktop\semantic-integration\textbooks_secondgrade_txt"
OUT_PATH = r"C:\Users\baile\Desktop\semantic-integration\candidate_sentences.md"

SOURCES = [
    ("science-textbook-grade-2.txt", "Science Textbook Grade 2"),
    ("The Astronomy Book Big Ideas Simply Explained.txt", "The Astronomy Book (Big Ideas)"),
    ("Story_of_the_World_History_for_the_Classical_Child_Volume_1_Ancient_Times_From_the_Earliest_Nomads_to_the_Last_Roman_Emperor.txt", "Story of the World Vol 1"),
    ("Story-of-the-World-v2-Middle-Ages-3-chs.txt", "Story of the World Vol 2 (Chs)"),
    ("sotw3_text_revisededition.txt", "Story of the World Vol 3"),
]

SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")

SKIP = [
    "copyright", "license", "isbn", "www.", "http", "table of contents",
]

pat = re.compile(r"\b(is|are|was|were)\b", re.IGNORECASE)

lines = ["# Candidate Sentences", "", "Filtered for short, declarative sentences with is/are/was/were.", ""]

for filename, title in SOURCES:
    path = os.path.join(BASE_DIR, filename)
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()
    sentences = []
    for chunk in text.splitlines():
        if not chunk.strip():
            continue
        if any(k in chunk.lower() for k in SKIP):
            continue
        for sent in SENTENCE_SPLIT.split(chunk):
            s = sent.strip()
            if not s.endswith("."):
                continue
            if not pat.search(s):
                continue
            if len(s.split()) < 5 or len(s.split()) > 18:
                continue
            sentences.append(s)
    lines.append(f"## {title}")
    for idx, s in enumerate(sentences[:140], 1):
        lines.append(f"{idx}. {s}")
    lines.append("")

with open(OUT_PATH, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
```

## Manual Curation and Editing
Items were manually curated to meet the semantic integration constraints:
- Stem 1 definitions are concise and age-appropriate.
- Stem 2 uses a generic verb to keep interactions simple.
- Integration replaces the target term with its definition and uses a more specific verb.
- Sensitive topics were avoided.

## Output
- Final dataset: [semantic_integration_items.md](semantic_integration_items.md) and [semantic_integration_items.csv](semantic_integration_items.csv)
- 100 items total, balanced across People: Object, Place: People, and Object: Place within the batch.

## Reproducibility
Scripts above document the conversion and candidate discovery steps. The final dataset was manually curated for coherence and age-appropriate language.