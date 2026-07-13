/** Semester planner: term math, plan suggestions from audit gaps,
 * auto-arrangement respecting prerequisites, and live validation. */
import type { NodeResult, PrereqNode, StudentRecord } from '../engine/types'

export type TermKind = 'long' | 'summer' | 'abroad'

export interface PlanTerm {
  id: string // "Fall 2026"
  kind: TermKind
  maxHours: number
}

export interface PlanItem {
  key: string
  /** concrete course ("SDS 354") or undefined for a placeholder slot */
  courseId?: string
  label: string
  hours: number
  /** term id, or null while in the unscheduled pool */
  termId: string | null
}

export interface Violation {
  itemKey?: string
  termId?: string
  kind: 'prereq' | 'overload' | 'abroad'
  message: string
}

const SEASONS = ['Spring', 'Summer', 'Fall'] as const

export function termIndex(termId: string): number {
  const m = termId.match(/^(Spring|Summer|Fall) (\d{4})$/)
  if (!m) return Number.MAX_SAFE_INTEGER
  return parseInt(m[2], 10) * 3 + SEASONS.indexOf(m[1] as (typeof SEASONS)[number])
}

export function nextTermId(termId: string, includeSummer: boolean): string {
  const idx = termIndex(termId) + 1
  const season = SEASONS[idx % 3]
  const year = Math.floor(idx / 3)
  const id = `${season} ${year}`
  return season === 'Summer' && !includeSummer ? nextTermId(id, includeSummer) : id
}

/** default four long semesters starting after the record's last term */
export function defaultTerms(lastTerm: string | undefined, count = 4): PlanTerm[] {
  let cur = lastTerm && termIndex(lastTerm) !== Number.MAX_SAFE_INTEGER ? lastTerm : 'Spring 2026'
  const terms: PlanTerm[] = []
  while (terms.length < count) {
    cur = nextTermId(cur, false)
    terms.push({ id: cur, kind: 'long', maxHours: 17 })
  }
  return terms
}

/** derive unscheduled plan items from a program audit's unmet requirements */
export function suggestionsFromAudit(results: NodeResult[]): PlanItem[] {
  const items: PlanItem[] = []
  const seen = new Set<string>()

  function visit(r: NodeResult, umbrellaDiscount = 0): void {
    const node = r.node
    if (r.status === 'met' || r.status === 'manual') return
    switch (node.type) {
      case 'all': {
        // umbrella children ("120 total hours") overlap their specific
        // siblings — only the hours the umbrella needs beyond them become
        // extra placeholder slots
        const specific = (r.children ?? [])
          .filter((c) => !c.node.umbrella)
          .reduce((a, c) => a + c.deficitHours, 0)
        r.children?.forEach((c) => visit(c, c.node.umbrella ? specific : 0))
        break
      }
      case 'anyN': {
        // suggest the cheapest unmet children needed to finish
        const unmet = (r.children ?? [])
          .filter((c) => c.status !== 'met')
          .sort((a, b) => a.deficitHours - b.deficitHours)
        const metCount = (r.children ?? []).filter((c) => c.status === 'met').length
        unmet.slice(0, Math.max(0, node.n - metCount)).forEach(visit)
        break
      }
      case 'course': {
        if (!seen.has(node.course)) {
          seen.add(node.course)
          items.push({
            key: `course:${node.course}`,
            courseId: node.course,
            label: node.course,
            hours: r.deficitHours || 3,
            termId: null,
          })
        }
        break
      }
      case 'hours': {
        const label = node.filter.label ?? node.title ?? 'Elective'
        const deficit = Math.max(0, r.deficitHours - umbrellaDiscount)
        const slots = Math.ceil(deficit / 3)
        for (let i = 0; i < slots; i++) {
          const key = `slot:${label}:${i}`
          if (seen.has(key)) continue
          seen.add(key)
          items.push({
            key,
            label,
            hours: Math.min(3, deficit - i * 3) || 3,
            termId: null,
          })
        }
        break
      }
      default:
        break
    }
  }

  results.forEach(visit)
  return items
}

function prereqMet(
  ast: PrereqNode,
  satisfied: (courseId: string) => boolean,
): boolean {
  switch (ast.type) {
    case 'course':
      return satisfied(ast.id)
    case 'all':
      return ast.of.every((n) => prereqMet(n, satisfied))
    case 'any':
      return ast.of.some((n) => prereqMet(n, satisfied))
  }
}

export interface PrereqLookup {
  (courseId: string): PrereqNode | undefined
}

function courseSatisfier(
  record: StudentRecord,
  items: PlanItem[],
  beforeIdx: number,
): (courseId: string) => boolean {
  const have = new Set(record.courses.map((c) => c.id))
  const haveBase = new Set(record.courses.map((c) => c.id.replace(/[AB]$/, '')))
  const planned = new Set(
    items
      .filter((it) => it.courseId && it.termId && termIndex(it.termId) < beforeIdx)
      .map((it) => it.courseId!),
  )
  return (id) => have.has(id) || haveBase.has(id) || planned.has(id)
}

/**
 * Greedy auto-arrangement: walk terms in order, fill each with items whose
 * prerequisites are satisfied by earlier work, up to the hour cap. Abroad
 * terms only take placeholder slots (transfer credit, not UT sections).
 */
export function autoArrange(
  items: PlanItem[],
  terms: PlanTerm[],
  record: StudentRecord,
  prereqOf: PrereqLookup,
): PlanItem[] {
  const pool = items.map((it) => ({ ...it, termId: null as string | null }))
  const sorted = [...terms].sort((a, b) => termIndex(a.id) - termIndex(b.id))
  for (const term of sorted) {
    let used = 0
    const idx = termIndex(term.id)
    for (const item of pool) {
      if (item.termId !== null) continue
      if (used + item.hours > term.maxHours) continue
      if (term.kind === 'abroad' && item.courseId) continue
      if (item.courseId) {
        const ast = prereqOf(item.courseId)
        if (ast && !prereqMet(ast, courseSatisfier(record, pool, idx))) continue
      }
      item.termId = term.id
      used += item.hours
    }
  }
  return pool
}

export function validatePlan(
  items: PlanItem[],
  terms: PlanTerm[],
  record: StudentRecord,
  prereqOf: PrereqLookup,
): Violation[] {
  const violations: Violation[] = []
  for (const term of terms) {
    const inTerm = items.filter((it) => it.termId === term.id)
    const hours = inTerm.reduce((a, it) => a + it.hours, 0)
    if (hours > term.maxHours) {
      violations.push({
        termId: term.id,
        kind: 'overload',
        message: `${term.id}: ${hours} hours exceeds the ${term.maxHours}-hour limit`,
      })
    }
    for (const item of inTerm) {
      if (term.kind === 'abroad' && item.courseId) {
        violations.push({
          itemKey: item.key,
          termId: term.id,
          kind: 'abroad',
          message: `${item.label}: specific UT courses can't be scheduled in a study-abroad term`,
        })
      }
      if (!item.courseId) continue
      const ast = prereqOf(item.courseId)
      if (ast && !prereqMet(ast, courseSatisfier(record, items, termIndex(term.id)))) {
        violations.push({
          itemKey: item.key,
          termId: term.id,
          kind: 'prereq',
          message: `${item.label}: prerequisites not met by earlier semesters`,
        })
      }
    }
  }
  return violations
}
