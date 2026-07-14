import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseAcademicSummary } from '../lib/summaryParser'
import { auditProgram, courseMatchesFilter, divisionOf, gradeSatisfies } from './evaluate'
import type { Program, RecordCourse, StudentRecord } from './types'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', '..', '..', 'data')

function loadProgram(edition: string, file: string): Program {
  return JSON.parse(readFileSync(join(dataDir, edition, 'programs', file), 'utf-8'))
}

const fixtureRecord: StudentRecord = parseAcademicSummary(
  readFileSync(join(here, '..', 'lib', '__fixtures__', 'academic-summary.txt'), 'utf-8'),
).record

describe('primitives', () => {
  it('grade comparisons', () => {
    expect(gradeSatisfies('A', 'C-')).toBe(true)
    expect(gradeSatisfies('D', 'C-')).toBe(false)
    expect(gradeSatisfies('CR', 'C-')).toBe(true) // credit by exam
    expect(gradeSatisfies('F')).toBe(false)
    expect(gradeSatisfies(undefined, 'C-')).toBe(true) // in progress
  })

  it('division from course number', () => {
    expect(divisionOf('SDS 313')).toBe('lower')
    expect(divisionOf('SDS 431')).toBe('upper')
    expect(divisionOf('PHL 610QA')).toBe('lower')
    expect(divisionOf('ECO 380K')).toBe('graduate')
  })

  it('filter matching incl. two-semester halves', () => {
    const phl: RecordCourse = {
      id: 'PHL 610QA', term: 'Fall 2024', hours: 3, grade: 'A', creditType: 'in-residence',
    }
    expect(courseMatchesFilter(phl, { courses: ['PHL 610Q'] })).toBe(true)
    expect(courseMatchesFilter(phl, { subjects: ['PHL'] })).toBe(true)
    expect(courseMatchesFilter(phl, { subjects: ['ECO'] })).toBe(false)
  })
})

describe('auditProgram against the real fixture record (2022-24 catalog)', () => {
  const sds = loadProgram('2022-24', 'major-bs-statistics-and-data-sciences.json')
  const core = loadProgram('2022-24', 'core-curriculum.json')
  const general = loadProgram('2022-24', 'layer-university-general.json')
  const cns = loadProgram('2022-24', 'layer-cns-college.json')

  const audit = auditProgram(sds, [core, general, cns], fixtureRecord)

  it('finds substantial progress toward BS SDS', () => {
    // fixture student has SDS 313/315/431/334/336, M 408C/D, M 340L,
    // C S 303E, C S 327E — most of the major
    expect(audit.percentComplete).toBeGreaterThan(0.5)
    expect(audit.remainingHours).toBeGreaterThan(0)
    expect(audit.remainingHours).toBeLessThan(60)
  })

  it('marks the calculus sequence met via M 408C + 408D', () => {
    const calc = audit.root.children!.find((r) => r.node.title === 'Calculus sequence')!
    expect(calc.status).toBe('met')
  })

  it('marks SDS core partially met (354 and 357 missing)', () => {
    const sdsCore = audit.root.children!.find((r) => r.node.title === 'SDS core courses')!
    expect(sdsCore.status).toBe('partial')
    const missing = sdsCore.children!.filter((r) => r.status === 'unmet')
    expect(missing.map((r) => (r.node as { course: string }).course).sort())
      .toEqual(['SDS 354', 'SDS 357'])
  })

  it('audits core curriculum layer with credit-by-exam counting', () => {
    const coreResult = audit.layers.find((l) => l.programId.includes('core'))!
    const gov = coreResult.root.children!.find((r) => (r.node.id ?? '').includes('070'))!
    expect(gov.status).toBe('met') // GOV 310L (CR) + GOV 312L (A)
    const history = coreResult.root.children!.find((r) => (r.node.id ?? '').includes('060'))!
    expect(history.status).toBe('met') // HIS 315L + HIS 301J by exam
  })

  it('has no manual checks — every requirement is evaluated or a note', () => {
    const audit = auditProgram(sds, [], fixtureRecord)
    expect(audit.manualLeaves).toBe(0)
    // notes are inert: they never appear as scorable units
    const statuses: string[] = []
    const collect = (r: typeof audit.root) => {
      statuses.push(r.status)
      r.children?.forEach(collect)
    }
    collect(audit.root)
    expect(statuses).not.toContain('manual')
  })
})

describe('auditProgram on Plan II (2022-24)', () => {
  const plan2 = loadProgram('2022-24', 'major-ba-plan-ii.json')
  const audit = auditProgram(plan2, [], fixtureRecord)

  it('matches PHL 610QA/QB and T C 302', () => {
    const phl = audit.root.children!.find((r) => r.node.title?.includes('philosophy'))!
    expect(phl.status).toBe('met')
    const tc = audit.root.children!.find((r) => r.node.title === 'First-year tutorial')!
    expect(tc.status).toBe('met')
  })

  it('sees one of two T C 358 semesters', () => {
    const sem = audit.root.children!.find((r) => r.node.title?.includes('358'))!
    expect(sem.status).toBe('partial')
    expect(sem.deficitHours).toBe(3)
  })
})

describe('concentration and majorField nodes', () => {
  const prog: Program = {
    id: 't/major/y', edition: 't', type: 'major', name: 'Y', college: 'T',
    sourceUrl: 'https://example.com',
    majorSubjects: ['SDS'],
    rules: {
      type: 'all',
      of: [
        { type: 'concentration', hours: 12, upperHours: 6, excludeSubjects: ['SDS'],
          title: 'Breadth' },
        { type: 'hours', hours: 6, inResidence: true,
          filter: { majorField: true, division: 'upper' },
          title: 'Advanced in-residence major hours' },
      ],
    },
  }
  const mk = (id: string, hours: number, creditType: 'in-residence' | 'transfer' = 'in-residence'): RecordCourse => ({
    id, term: 'Fall 2024', hours, grade: 'A', creditType,
  })

  it('finds the best single field for breadth (excluding the major)', () => {
    const record: StudentRecord = {
      majors: [], schools: [],
      courses: [
        mk('SDS 375', 12), // excluded subject — cannot satisfy breadth
        mk('C S 303E', 3), mk('C S 313E', 3), mk('C S 327E', 3), mk('C S 331', 3),
      ],
    }
    const audit = auditProgram(prog, [], record)
    const breadth = audit.root.children![0]
    expect(breadth.status).toBe('met') // 12 CS hours, 9 upper-division
    expect(breadth.matched.every((c) => c.id.startsWith('C S'))).toBe(true)
  })

  it('reports the max of total/upper shortfalls as the deficit', () => {
    const record: StudentRecord = {
      majors: [], schools: [],
      courses: [mk('BIO 311C', 3), mk('BIO 311D', 3), mk('BIO 206L', 2), mk('BIO 315H', 3)],
    }
    const audit = auditProgram(prog, [], record)
    const breadth = audit.root.children![0]
    expect(breadth.status).toBe('partial')
    expect(breadth.deficitHours).toBe(6) // 11/12 total but 0/6 upper → max(1, 6)
  })

  it('resolves majorField filters from the program majorSubjects', () => {
    const record: StudentRecord = {
      majors: [], schools: [],
      courses: [
        mk('SDS 334', 3), mk('SDS 336', 3), // upper-division SDS in residence
        mk('SDS 375', 3, 'transfer'), // transfer — doesn't count
      ],
    }
    const audit = auditProgram(prog, [], record)
    const adv = audit.root.children![1]
    expect(adv.status).toBe('met')
    expect(adv.matched.map((c) => c.id).sort()).toEqual(['SDS 334', 'SDS 336'])
  })
})

describe('single-field concentration with an includeSubjects pool', () => {
  const prog: Program = {
    id: 't/major/lang', edition: 't', type: 'major', name: 'L', college: 'T',
    sourceUrl: 'https://example.com',
    rules: {
      type: 'concentration', hours: 6, upperHours: 6,
      includeSubjects: ['SPN', 'FR', 'GER'],
      title: '6 upper-division hours in one foreign language',
    },
  }
  const mk = (id: string, hours = 3): RecordCourse => ({
    id, term: 'Fall 2024', hours, grade: 'A', creditType: 'in-residence',
  })

  it('requires the hours to come from a single pooled subject', () => {
    // 3 Spanish + 3 French upper-division = 6 total but not one language
    const split: StudentRecord = { majors: [], schools: [], courses: [mk('SPN 340'), mk('FR 340')] }
    expect(auditProgram(prog, [], split).root.status).toBe('partial')
    // 6 upper-division Spanish hours in one language -> met
    const oneLang: StudentRecord = { majors: [], schools: [], courses: [mk('SPN 340'), mk('SPN 350')] }
    const audit = auditProgram(prog, [], oneLang)
    expect(audit.root.status).toBe('met')
    expect(audit.root.matched.every((c) => c.id.startsWith('SPN'))).toBe(true)
  })

  it('ignores subjects outside the pool', () => {
    const rec: StudentRecord = { majors: [], schools: [], courses: [mk('ECO 340'), mk('ECO 350')] }
    expect(auditProgram(prog, [], rec).root.status).toBe('unmet')
  })
})

describe('synthetic edge cases', () => {
  const prog: Program = {
    id: 't/major/x', edition: 't', type: 'major', name: 'X', college: 'T',
    sourceUrl: 'https://example.com',
    rules: {
      type: 'all',
      of: [
        { type: 'hours', hours: 6, filter: { subjects: ['ECO'] }, caps: [
          { filter: { courses: ['ECO 119'] }, maxHours: 1, note: 'cap' },
        ] },
        { type: 'gpa', min: 3.5, scope: { subjects: ['ECO'] } },
      ],
    },
  }
  const mk = (id: string, grade: string | undefined, hours: number): RecordCourse => ({
    id, term: 'Fall 2024', hours, grade, creditType: 'in-residence',
  })

  it('applies caps and grade-scoped GPA', () => {
    const record: StudentRecord = {
      majors: [], schools: [],
      courses: [mk('ECO 304K', 'B', 3), mk('ECO 119', 'A', 1), mk('ECO 320L', 'A', 3)],
    }
    const audit = auditProgram(prog, [], record)
    const hoursNode = audit.root.children![0]
    expect(hoursNode.status).toBe('met') // 3 + 1(capped) + 3 = 7
    const gpaNode = audit.root.children![1]
    expect(gpaNode.status).toBe('met') // (3*3 + 4*1 + 4*3)/7 = 3.57
  })

  it('excludes Q/W/F grades from counting', () => {
    const record: StudentRecord = {
      majors: [], schools: [],
      courses: [mk('ECO 304K', 'F', 3), mk('ECO 304L', 'Q', 3)],
    }
    const audit = auditProgram(prog, [], record)
    expect(audit.root.children![0].status).toBe('unmet')
    expect(audit.root.children![0].deficitHours).toBe(6)
  })
})
