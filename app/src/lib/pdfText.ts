/**
 * Extract text lines from an Academic Summary PDF using pdf.js, emitting
 * one table cell per line (wrapped cell fragments rejoined) — the same
 * shape the paste-text path produces, consumed by summaryParser.
 *
 * Layout facts (measured from real summaries): each course row's cells
 * share a baseline Y; a wrapped cell renders its extra fragments one text
 * line ABOVE the baseline (~12pt); every table repeats a header row
 * ("Course | Title | Grade | ...") whose item X positions define the
 * column boundaries. Non-table text (page furniture, term titles, header
 * fields, footer totals) is emitted as visual lines split at large
 * horizontal gaps, so two-column header fields stay separate.
 */

interface Item {
  str: string
  x: number
  y: number
  w: number
}

const HEADER_LABELS = ['Course', 'Title', 'Grade', 'Unique', 'Type', 'Credit Hours', 'Grade Points']
const Y_TOL = 2.5
/** wrapped fragments sit up to two text lines above the row baseline */
const ROW_SPAN = 26
/** horizontal gap that separates two logical fields on one visual line */
const SEGMENT_GAP = 30

function visualLines(items: Item[]): Item[][] {
  const lines: Item[][] = []
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l[0].y - it.y) <= Y_TOL)
    if (line) line.push(it)
    else lines.push([it])
  }
  return lines.map((l) => l.sort((a, b) => a.x - b.x))
}

const HEADER_KEY_RE =
  /^(EID|Name|School \d|Major \d|First Semester Enrolled|Last Semester Enrolled|Date Degree Expected|Classification):/

/**
 * Emit a visual line as one or more lines, splitting at big x-gaps and
 * before a new "Key: value" header field (two-column header rows can sit
 * closer together than the gap threshold).
 */
function emitPlain(lines: Item[][]): string[] {
  const out: string[] = []
  for (const line of lines) {
    let current = ''
    let lastEnd = -Infinity
    for (const it of line) {
      if (current && (it.x - lastEnd > SEGMENT_GAP || HEADER_KEY_RE.test(it.str.trim()))) {
        out.push(current)
        current = it.str
      } else {
        current = current ? `${current} ${it.str}` : it.str
      }
      lastEnd = it.x + it.w
    }
    if (current) out.push(current)
  }
  return out.map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 0)
}

export function itemsToLines(rawItems: Item[]): string[] {
  const items = rawItems.filter((it) => it.str.trim().length > 0)
  const lines = visualLines(items)

  // header rows: visual lines containing >= 5 of the known labels
  const headerIdxs = lines
    .map((l, i) => ({ i, hits: l.filter((it) => HEADER_LABELS.includes(it.str.trim())).length }))
    .filter((h) => h.hits >= 5)
    .map((h) => h.i)

  if (headerIdxs.length === 0) return emitPlain(lines)

  const out: string[] = []
  let cursor = 0
  for (let h = 0; h < headerIdxs.length; h++) {
    const headerLine = lines[headerIdxs[h]]
    out.push(...emitPlain(lines.slice(cursor, headerIdxs[h])))

    const colX = headerLine.map((it) => it.x)
    const colOf = (x: number) => {
      let col = 0
      for (let c = 0; c < colX.length; c++) if (x >= colX[c] - 12) col = c
      return col
    }

    const bandEnd = h + 1 < headerIdxs.length ? headerIdxs[h + 1] : lines.length
    const band = lines.slice(headerIdxs[h] + 1, bandEnd).flat()

    // Row baselines: Ys carrying items in >= 2 distinct anchor columns
    // (grade..points). A wrapped fragment like "Credit by" one line up
    // occupies a single column and must not spawn a phantom row.
    const candidates = new Map<number, Set<number>>()
    for (const it of band) {
      const col = colOf(it.x)
      if (col < 2) continue
      const key = [...candidates.keys()].find((y) => Math.abs(y - it.y) <= Y_TOL) ?? it.y
      if (!candidates.has(key)) candidates.set(key, new Set())
      candidates.get(key)!.add(col)
    }
    const baselines = [...candidates.entries()]
      .filter(([, cols]) => cols.size >= 2)
      .map(([y]) => y)
      .sort((a, b) => b - a)

    type Row = { baseline: number; cells: Item[][] }
    const rows: Row[] = baselines.map((b) => ({
      baseline: b,
      cells: HEADER_LABELS.map(() => []),
    }))
    const loose: Item[] = []
    for (const it of band) {
      const row = rows.find(
        (r) => it.y >= r.baseline - Y_TOL && it.y <= r.baseline + ROW_SPAN,
      )
      if (row) row.cells[colOf(it.x)].push(it)
      else loose.push(it)
    }

    for (const row of rows) {
      for (const cell of row.cells) {
        if (cell.length === 0) continue
        // top-down, left-right within a cell (wrap order)
        cell.sort((a, b) => b.y - a.y || a.x - b.x)
        out.push(cell.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim())
      }
    }
    out.push(...emitPlain(visualLines(loose)))
    cursor = bandEnd
  }
  out.push(...emitPlain(lines.slice(cursor)))
  return out.filter((l) => l.length > 0)
}

export async function extractPdfLines(data: ArrayBuffer): Promise<string[]> {
  // the legacy build works in Node (tests); the standard build in browsers
  const pdfjs =
    typeof window === 'undefined'
      ? await import('pdfjs-dist/legacy/build/pdf.mjs')
      : await import('pdfjs-dist')
  if (typeof window !== 'undefined') {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString()
  }
  const doc = await pdfjs.getDocument({ data }).promise
  const all: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const items: Item[] = (content.items as unknown as Array<Record<string, unknown>>)
      .filter((it) => typeof it.str === 'string')
      .map((it) => ({
        str: it.str as string,
        x: (it.transform as number[])[4],
        y: (it.transform as number[])[5],
        w: (it.width as number) ?? 0,
      }))
    all.push(...itemsToLines(items))
  }
  return all
}

export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  return (await extractPdfLines(data)).join('\n')
}
