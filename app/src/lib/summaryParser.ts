/**
 * Parser for UT Austin's Academic Summary (the unofficial transcript from
 * Texas One Stop / UT Direct).
 *
 * Works on a stream of text lines. The PDF path reconstructs lines from
 * pdf.js text items grouped by Y position (see pdfText.ts); the paste path
 * splits on newlines. In the extracted text every table cell sits on its
 * own line and long cells wrap, so the parser anchors each course row on
 * its most reliable landmarks (the 5-digit unique number, the credit-type
 * phrase, and the trailing hours / grade-points decimals) and treats
 * everything between the course code and those anchors as the title.
 * In-progress courses have no grade line.
 */
import type { CreditType, RecordCourse, StudentRecord } from '../engine/types'

const TERM_RE = /^(Fall|Spring|Summer) (\d{4}) Courses$/
const GRADE_RE = /^(A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|F|CR|NC|Q|W|X|I)$/
const UNIQUE_RE = /^\d{5}$/
const DECIMAL_RE = /^\d+\.\d+$/
// "PHL 610QA" may arrive as one line or split across two ("PHL" / "610QA").
const COURSE_ONELINE_RE = /^([A-Z][A-Z &]{0,5}?) ?(\d[0-9A-Z]{2,5})$/
const SUBJECT_ONLY_RE = /^[A-Z][A-Z &]{0,5}$/
const NUMBER_ONLY_RE = /^\d[0-9A-Z]{2,5}$/

const CREDIT_TYPES: [RegExp, CreditType][] = [
  [/^In residence$/i, 'in-residence'],
  [/^Credit by ?exam$/i, 'credit-by-exam'],
  [/^Transfer/i, 'transfer'],
  [/^Extension$/i, 'extension'],
  [/^Correspondence$/i, 'correspondence'],
]

const FURNITURE = [
  /^Academic Summary( Unofficial Document)?$/,
  /^Unofficial Document$/,
  /^Page \d+ of \d+$/,
  /^The University of Texas at Austin$/,
  /^Course$/, /^Title$/, /^Grade$/, /^Unique$/, /^Type$/,
  /^Credit Hours$/, /^Grade Points$/,
]

function isFurniture(line: string): boolean {
  return FURNITURE.some((re) => re.test(line))
}

/** Normalize whitespace and join credit-type phrases that wrapped. */
function preprocess(text: string): string[] {
  const raw = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0 && !isFurniture(l))
  const lines: string[] = []
  for (const line of raw) {
    const prev = lines[lines.length - 1]
    // rejoin wrapped credit types: "Credit by" + "exam"
    if (prev && /^(Credit by|In)$/i.test(prev)) {
      lines[lines.length - 1] = `${prev} ${line}`
      continue
    }
    lines.push(line)
  }
  return lines
}

interface HeaderState {
  record: StudentRecord
  /** header key currently accepting wrapped continuation lines */
  pendingKey?: 'major' | 'school'
}

function parseHeaderLine(line: string, st: HeaderState): boolean {
  const kv = line.match(/^([A-Za-z0-9 ]+):\s*(.*)$/)
  if (kv) {
    const key = kv[1].trim()
    const value = kv[2].trim()
    // Major/School values can wrap onto later lines even with other
    // two-column fields (e.g. "Last Semester Enrolled") emitted between
    // them, so only a new Major/School key retargets the continuation.
    if (key === 'EID') st.record.eid = value
    else if (key === 'Name') st.record.name = value
    else if (/^School \d$/.test(key)) {
      st.record.schools.push(value)
      st.pendingKey = 'school'
    } else if (/^Major \d$/.test(key)) {
      st.record.majors.push(value)
      st.pendingKey = 'major'
    } else if (key === 'First Semester Enrolled') st.record.firstSemester = value
    else if (key === 'Last Semester Enrolled') st.record.lastSemester = value
    else if (key === 'Classification') st.record.classification = value
    else if (key === 'Date Degree Expected') { /* ignore */ }
    else return false
    return true
  }
  // wrapped continuation of a Major/School value ("PREVET" after
  // "PLAN II HONORS PROGRAM/PREMED, PREDENT,")
  if (st.pendingKey === 'major' && st.record.majors.length > 0) {
    st.record.majors[st.record.majors.length - 1] += ` ${line}`
    return true
  }
  if (st.pendingKey === 'school' && st.record.schools.length > 0) {
    st.record.schools[st.record.schools.length - 1] += ` ${line}`
    return true
  }
  return false
}

function matchCreditType(line: string): CreditType | undefined {
  for (const [re, type] of CREDIT_TYPES) if (re.test(line)) return type
  return undefined
}

/**
 * Parse one course row starting at lines[i] (which must look like a course
 * code). Returns the row and the index just past it, or null if the shape
 * doesn't hold (caller then skips the line).
 */
function parseRow(
  lines: string[],
  i: number,
  term: string,
): { course: RecordCourse; next: number } | null {
  let subject: string
  let number: string
  let j = i
  const one = lines[j].match(COURSE_ONELINE_RE)
  if (one) {
    subject = one[1].trim()
    number = one[2]
    j++
  } else if (
    SUBJECT_ONLY_RE.test(lines[j]) &&
    j + 1 < lines.length &&
    NUMBER_ONLY_RE.test(lines[j + 1])
  ) {
    subject = lines[j].trim()
    number = lines[j + 1]
    j += 2
  } else {
    return null
  }

  // scan forward to the credit-type anchor; grade and unique sit just
  // before it, title lines before those.
  let typeIdx = -1
  for (let k = j; k < Math.min(j + 8, lines.length); k++) {
    if (matchCreditType(lines[k])) {
      typeIdx = k
      break
    }
  }
  if (typeIdx < 0) return null
  const creditType = matchCreditType(lines[typeIdx])!

  let uniqueIdx = -1
  for (let k = j; k < typeIdx; k++) if (UNIQUE_RE.test(lines[k])) uniqueIdx = k
  const uniqueNumber = uniqueIdx >= 0 ? lines[uniqueIdx] : undefined

  let grade: string | undefined
  let titleEnd = uniqueIdx >= 0 ? uniqueIdx : typeIdx
  if (titleEnd > j && GRADE_RE.test(lines[titleEnd - 1])) {
    grade = lines[titleEnd - 1]
    titleEnd -= 1
  }
  const title = lines.slice(j, titleEnd).join(' ').trim()

  // hours + grade points trail the credit type
  let hours: number | undefined
  let next = typeIdx + 1
  if (next < lines.length && DECIMAL_RE.test(lines[next])) {
    hours = parseFloat(lines[next])
    next++
    if (next < lines.length && DECIMAL_RE.test(lines[next])) next++ // grade points
  }

  return {
    course: {
      id: `${subject} ${number}`,
      title: title || undefined,
      term,
      hours: hours ?? 0,
      grade,
      creditType,
      uniqueNumber,
    },
    next,
  }
}

export interface ParseResult {
  record: StudentRecord
  warnings: string[]
}

export function parseAcademicSummary(text: string): ParseResult {
  const lines = preprocess(text)
  const warnings: string[] = []
  const record: StudentRecord = { majors: [], schools: [], courses: [] }
  const st: HeaderState = { record }

  let term: string | null = null
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const termMatch = line.match(TERM_RE)
    if (termMatch) {
      term = `${termMatch[1]} ${termMatch[2]}`
      st.pendingKey = undefined
      i++
      continue
    }
    if (/^Total Hours Taken:/.test(line) || /^Total Hours Transferred:/.test(line)) {
      break
    }
    if (!term) {
      if (!parseHeaderLine(line, st)) {
        // unknown header line; ignore quietly (page furniture variants)
      }
      i++
      continue
    }
    const row = parseRow(lines, i, term)
    if (row) {
      record.courses.push(row.course)
      i = row.next
    } else {
      warnings.push(`Unrecognized line in ${term}: "${line}"`)
      i++
    }
  }

  // footer totals: last GPA is the overall one; "Total Hours Taken" is overall
  const tail = lines.slice(i).join('\n')
  const totalHours = tail.match(/Total Hours Taken:\s*([\d.]+)/)
  const gpas = [...tail.matchAll(/GPA:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]))
  record.totals = {
    overallHours: totalHours ? parseFloat(totalHours[1]) : undefined,
    overallGpa: gpas.length > 0 ? gpas[gpas.length - 1] : undefined,
  }

  if (record.courses.length === 0) {
    warnings.push('No courses found — is this an Academic Summary?')
  }
  return { record, warnings }
}
