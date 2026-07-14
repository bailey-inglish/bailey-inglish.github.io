import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseAcademicSummary } from './summaryParser'

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'academic-summary.txt'),
  'utf-8',
)

describe('parseAcademicSummary', () => {
  const { record, warnings } = parseAcademicSummary(fixture)

  it('parses the header', () => {
    expect(record.eid).toBe('ABC123')
    expect(record.name).toBe('STUDENT, EXAMPLE')
    expect(record.schools).toEqual(['NATURAL SCIENCES (E)', 'LIBERAL ARTS (L)'])
    expect(record.majors[0]).toBe('STATISTICS AND DATA SCIENCE (BSSDS)/PLAN II')
    // wrapped major value is rejoined
    expect(record.majors[1]).toBe('PLAN II HONORS PROGRAM/PREMED, PREDENT, PREVET')
    expect(record.classification).toBe('SENIOR')
    expect(record.firstSemester).toBe('Fall 2023')
  })

  it('parses every course row', () => {
    expect(record.courses).toHaveLength(38)
    expect(warnings).toEqual([])
  })

  it('handles a normal in-residence row', () => {
    const sds313 = record.courses.find((c) => c.id === 'SDS 313')!
    expect(sds313).toMatchObject({
      term: 'Fall 2023',
      grade: 'A',
      hours: 3,
      creditType: 'in-residence',
      uniqueNumber: '58199',
    })
  })

  it('rejoins wrapped titles and wrapped course codes', () => {
    const phl = record.courses.find((c) => c.id === 'PHL 610QA')!
    expect(phl.title).toBe('PROBS OF KNOWLEDGE & VALUATION')
    expect(phl.hours).toBe(3)
    const tc302 = record.courses.find((c) => c.id === 'T C 302')!
    expect(tc302.title).toBe('HEALER/PATIENT/SOCIETY/CULTU RE')
  })

  it('handles credit-by-exam rows with wrapped type', () => {
    const gov = record.courses.find((c) => c.id === 'GOV 310L')!
    expect(gov.creditType).toBe('credit-by-exam')
    expect(gov.grade).toBe('CR')
  })

  it('handles in-progress rows with no grade', () => {
    const bdp = record.courses.find((c) => c.id === 'BDP 325K')!
    expect(bdp.grade).toBeUndefined()
    expect(bdp.creditType).toBe('extension')
    expect(bdp.term).toBe('Summer 2026')
    expect(bdp.hours).toBe(3)
  })

  it('parses footer totals', () => {
    expect(record.totals?.overallHours).toBe(100)
    expect(record.totals?.overallGpa).toBe(4)
  })
})

describe('parseAcademicSummary on pdf.js-extracted lines', () => {
  const pdfFixture = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'academic-summary-pdfjs.txt'),
    'utf-8',
  )
  const { record, warnings } = parseAcademicSummary(pdfFixture)

  it('parses the full record without warnings', () => {
    expect(warnings).toEqual([])
    expect(record.courses).toHaveLength(38)
    expect(record.majors).toEqual([
      'STATISTICS AND DATA SCIENCE (BSSDS)/PLAN II',
      'PLAN II HONORS PROGRAM/PREMED, PREDENT, PREVET',
    ])
    expect(record.lastSemester).toBe('Spring 2026')
    const m408c = record.courses.find((c) => c.id === 'M 408C')!
    expect(m408c.creditType).toBe('credit-by-exam')
    expect(m408c.title).toBe('DIFFEREN AND INTEGRAL CALCULUS')
  })
})
