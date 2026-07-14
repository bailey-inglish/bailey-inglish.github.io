import { describe, expect, it } from 'vitest'
import type { PrereqNode, StudentRecord } from '../engine/types'
import { autoArrange, defaultTerms, nextTermId, termIndex, validatePlan } from './planner'
import type { PlanItem, PlanTerm } from './planner'

const record: StudentRecord = {
  majors: [], schools: [],
  courses: [
    { id: 'SDS 315', term: 'Spring 2024', hours: 3, grade: 'A', creditType: 'in-residence' },
  ],
}

const prereqs: Record<string, PrereqNode> = {
  'SDS 334': { type: 'course', id: 'SDS 315' },
  'SDS 354': { type: 'course', id: 'SDS 334' },
  'SDS 357': { type: 'all', of: [{ type: 'course', id: 'SDS 334' }, { type: 'course', id: 'SDS 354' }] },
}
const prereqOf = (id: string) => prereqs[id]

const mkItem = (courseId: string): PlanItem => ({
  key: `course:${courseId}`, courseId, label: courseId, hours: 3, termId: null,
})

describe('term math', () => {
  it('orders and advances terms', () => {
    expect(termIndex('Fall 2026')).toBeGreaterThan(termIndex('Spring 2026'))
    expect(nextTermId('Fall 2026', false)).toBe('Spring 2027')
    expect(nextTermId('Spring 2027', false)).toBe('Fall 2027')
    expect(nextTermId('Spring 2027', true)).toBe('Summer 2027')
    expect(defaultTerms('Spring 2026', 2).map((t) => t.id)).toEqual(['Fall 2026', 'Spring 2027'])
  })
})

describe('autoArrange', () => {
  it('respects prerequisite chains across terms', () => {
    const terms: PlanTerm[] = [
      { id: 'Fall 2026', kind: 'long', maxHours: 15 },
      { id: 'Spring 2027', kind: 'long', maxHours: 15 },
      { id: 'Fall 2027', kind: 'long', maxHours: 15 },
    ]
    const items = [mkItem('SDS 357'), mkItem('SDS 354'), mkItem('SDS 334')]
    const placed = autoArrange(items, terms, record, prereqOf)
    const term = (id: string) => placed.find((it) => it.courseId === id)!.termId
    expect(term('SDS 334')).toBe('Fall 2026') // prereq SDS 315 already taken
    expect(term('SDS 354')).toBe('Spring 2027')
    expect(term('SDS 357')).toBe('Fall 2027')
  })

  it('keeps concrete courses out of abroad terms and respects hour caps', () => {
    const terms: PlanTerm[] = [
      { id: 'Fall 2026', kind: 'abroad', maxHours: 12 },
      { id: 'Spring 2027', kind: 'long', maxHours: 6 },
    ]
    const items = [
      mkItem('SDS 334'),
      { key: 'slot:elective:0', label: 'Elective', hours: 3, termId: null },
      mkItem('SDS 354'),
    ]
    const placed = autoArrange(items, terms, record, prereqOf)
    expect(placed.find((it) => it.key === 'slot:elective:0')!.termId).toBe('Fall 2026')
    expect(placed.find((it) => it.courseId === 'SDS 334')!.termId).toBe('Spring 2027')
    // SDS 354 can't fit (6-hour cap) and its prereq lands the same term
    expect(placed.find((it) => it.courseId === 'SDS 354')!.termId).toBeNull()
  })
})

describe('validatePlan', () => {
  it('flags prereq violations, overloads, and abroad conflicts', () => {
    const terms: PlanTerm[] = [
      { id: 'Fall 2026', kind: 'abroad', maxHours: 3 },
      { id: 'Spring 2027', kind: 'long', maxHours: 15 },
    ]
    const items: PlanItem[] = [
      { ...mkItem('SDS 354'), termId: 'Fall 2026' }, // abroad + prereq unmet
      { key: 's1', label: 'Elective', hours: 3, termId: 'Fall 2026' }, // overload with above
      { ...mkItem('SDS 334'), termId: 'Spring 2027' }, // fine (315 taken)
    ]
    const violations = validatePlan(items, terms, record, prereqOf)
    const kinds = violations.map((v) => v.kind).sort()
    expect(kinds).toEqual(['abroad', 'overload', 'prereq'])
  })
})
