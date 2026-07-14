/**
 * Parser for UT Austin's Academic Summary (the unofficial transcript from
 * Texas One Stop / UT Direct).
 *
 * Works on plain text, from either input path:
 *   - the PDF path (pdfText.ts) emits one table cell per line
 *   - copy-paste from a browser PDF viewer flattens each row onto one line
 *     (e.g. "RE A 42040 In residence 3.0 12.00")
 * and different exports interleave the header fields differently.
 *
 * To be robust to all of these, course rows are parsed from a whitespace
 * token stream rather than by line position. Each row is found by its most
 * reliable landmark — the 5-digit unique number followed by a credit-type
 * phrase and the trailing hours/grade-points decimals. Everything between
 * one row's tail and the next row's course code is
 * `SUBJECT NUMBER TITLE… [GRADE]`, which is unwound from the ends in.
 */
import type { CreditType, RecordCourse, StudentRecord } from '../engine/types'

const TERM_RE = /(Fall|Spring|Summer)\s+(\d{4})\s+Courses/g
const GRADE_RE = /^(A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|F|CR|NC|Q|W|X|I)$/
const UNIQUE_RE = /^\d{5}$/
const DECIMAL_RE = /^\d+\.\d+$/
const SUBJECT_TOKEN_RE = /^[A-Z][A-Z&]?$|^[A-Z]{2,5}$/
const NUMBER_TOKEN_RE = /^\d[0-9A-Z]*$/

/** credit-type phrases, longest first so multi-word phrases win */
const CREDIT_TYPES: [string[], CreditType][] = [
  [['Credit', 'by', 'exam'], 'credit-by-exam'],
  [['In', 'residence'], 'in-residence'],
  [['Extension'], 'extension'],
  [['Correspondence'], 'correspondence'],
  [['Transfer'], 'transfer'],
]

const FURNITURE = [
  /^Academic Summary( Unofficial Document)?/,
  /^Unofficial Document$/,
  /^Page \d+ of \d+$/,
  /^The University of Texas at Austin$/,
  /^Course\s+Title\s+Grade\s+Unique\s+Type/,
  /^Course$/, /^Title$/, /^Grade$/, /^Unique$/, /^Type$/,
  /^Credit Hours$/, /^Grade Points$/,
]

const HEADER_KEY_RE =
  /(EID|Name|School \d+|Major \d+|Classification|First Semester Enrolled|Last Semester Enrolled|Date Degree Expected)\s*:/g

function isFurniture(line: string): boolean {
  return FURNITURE.some((re) => re.test(line))
}

/** match a credit-type phrase starting at tokens[i]; returns [type, length] */
function matchCreditType(tokens: string[], i: number): [CreditType, number] | null {
  for (const [phrase, type] of CREDIT_TYPES) {
    if (phrase.every((w, k) => tokens[i + k] === w)) return [type, phrase.length]
  }
  return null
}

interface ParsedRow {
  course: RecordCourse
  /** index just past this row in the token stream */
  next: number
}

/**
 * Parse one course row from `tokens`, given the index `tailStart` of its
 * 5-digit unique number, and `segStart` where the row's content began
 * (just after the previous row). Returns null if the segment has no
 * recognizable course code.
 */
function parseRow(
  tokens: string[],
  segStart: number,
  tailStart: number,
  term: string,
): ParsedRow | null {
  const seg = tokens.slice(segStart, tailStart)
  // course code: subject tokens then the first number-looking token
  let numIdx = -1
  for (let k = 0; k < seg.length; k++) {
    if (NUMBER_TOKEN_RE.test(seg[k]) && seg.slice(0, k).every((t) => SUBJECT_TOKEN_RE.test(t)) && k > 0) {
      numIdx = k
      break
    }
  }
  if (numIdx < 0) return null
  const subject = seg.slice(0, numIdx).join(' ')
  const number = seg[numIdx]
  let rest = seg.slice(numIdx + 1)
  // trailing grade token (absent for in-progress rows)
  let grade: string | undefined
  if (rest.length > 0 && GRADE_RE.test(rest[rest.length - 1])) {
    grade = rest[rest.length - 1]
    rest = rest.slice(0, -1)
  }
  const title = rest.join(' ').trim() || undefined

  const uniqueNumber = tokens[tailStart]
  const typeMatch = matchCreditType(tokens, tailStart + 1)!
  const [creditType, typeLen] = typeMatch
  let cursor = tailStart + 1 + typeLen
  let hours = 0
  if (DECIMAL_RE.test(tokens[cursor])) {
    hours = parseFloat(tokens[cursor])
    cursor++
    if (DECIMAL_RE.test(tokens[cursor])) cursor++ // grade points
  }

  return {
    course: { id: `${subject} ${number}`, title, term, hours, grade, creditType, uniqueNumber },
    next: cursor,
  }
}

/** Parse all course rows out of one term's token stream. */
function parseTermRows(tokens: string[], term: string, warnings: string[]): RecordCourse[] {
  const rows: RecordCourse[] = []
  let i = 0
  while (i < tokens.length) {
    // find the next row tail: a 5-digit unique followed by a credit type
    let j = i
    while (j < tokens.length && !(UNIQUE_RE.test(tokens[j]) && matchCreditType(tokens, j + 1))) j++
    if (j >= tokens.length) {
      const leftover = tokens.slice(i).join(' ').trim()
      if (leftover) warnings.push(`Unparsed text in ${term}: "${leftover.slice(0, 60)}"`)
      break
    }
    const parsed = parseRow(tokens, i, j, term)
    if (parsed) {
      rows.push(parsed.course)
      i = parsed.next
    } else {
      // couldn't find a course code before this unique — skip past it
      warnings.push(`Skipped an unrecognized row near unique ${tokens[j]} in ${term}`)
      i = j + 1
    }
  }
  return rows
}

function parseHeader(preamble: string, record: StudentRecord): void {
  const matches = [...preamble.matchAll(HEADER_KEY_RE)]
  for (let m = 0; m < matches.length; m++) {
    const key = matches[m][1].trim()
    const start = matches[m].index! + matches[m][0].length
    const end = m + 1 < matches.length ? matches[m + 1].index! : preamble.length
    const value = preamble.slice(start, end).replace(/\s+/g, ' ').trim()
    if (key === 'EID') record.eid = value
    else if (key === 'Name') record.name = value
    else if (/^School \d+$/.test(key)) record.schools.push(value)
    else if (/^Major \d+$/.test(key)) record.majors.push(value)
    else if (key === 'Classification') record.classification = value
    else if (key === 'First Semester Enrolled') record.firstSemester = value
    else if (key === 'Last Semester Enrolled') record.lastSemester = value
  }
}

export interface ParseResult {
  record: StudentRecord
  warnings: string[]
}

export function parseAcademicSummary(text: string): ParseResult {
  const warnings: string[] = []
  const record: StudentRecord = { majors: [], schools: [], courses: [] }

  // strip page furniture / column headers, then rejoin into one stream so
  // term segmentation is independent of how rows were wrapped
  const body = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0 && !isFurniture(l))
    .join(' ')

  // everything before the first "<Term> Courses" is the header block; the
  // footer totals begin at "Total Hours"
  const totalsCut = body.search(/Total Hours (Taken|Transferred)/)
  const coursesText = totalsCut >= 0 ? body.slice(0, totalsCut) : body
  const footer = totalsCut >= 0 ? body.slice(totalsCut) : ''

  TERM_RE.lastIndex = 0
  const termMatches = [...coursesText.matchAll(TERM_RE)]
  if (termMatches.length > 0) {
    parseHeader(coursesText.slice(0, termMatches[0].index), record)
  } else {
    parseHeader(coursesText, record)
  }

  for (let t = 0; t < termMatches.length; t++) {
    const term = `${termMatches[t][1]} ${termMatches[t][2]}`
    const start = termMatches[t].index! + termMatches[t][0].length
    const end = t + 1 < termMatches.length ? termMatches[t + 1].index! : coursesText.length
    const tokens = coursesText.slice(start, end).split(/\s+/).filter(Boolean)
    record.courses.push(...parseTermRows(tokens, term, warnings))
  }

  // footer totals: the final GPA is the overall one
  const totalHours = footer.match(/Total Hours Taken:\s*([\d.]+)/)
  const gpas = [...footer.matchAll(/GPA:\s*([\d.]+)/g)].map((g) => parseFloat(g[1]))
  record.totals = {
    overallHours: totalHours ? parseFloat(totalHours[1]) : undefined,
    overallGpa: gpas.length > 0 ? gpas[gpas.length - 1] : undefined,
  }

  if (record.courses.length === 0) {
    warnings.unshift('No courses found — is this an Academic Summary? You can also add courses manually under “My record”.')
  }
  return { record, warnings }
}
