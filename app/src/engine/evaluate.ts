/**
 * Audit engine: evaluates requirement rule trees against a student record.
 *
 * Semantics (see types.ts for rationale):
 * - Nodes are evaluated independently — a course may satisfy several nodes
 *   (umbrella rules depend on this). Explicit `caps` restrict how many
 *   hours a filtered subset may contribute to a node.
 * - `manual` nodes are never auto-satisfied; the UI lets users check them
 *   off, passed in via `manualChecks`.
 * - In-progress and planned courses count toward satisfaction (they're the
 *   whole point of planning); results carry enough info for the UI to show
 *   which matches are not yet final.
 */
import type {
  CourseFilter,
  NodeResult,
  NodeStatus,
  Program,
  ProgramAudit,
  RecordCourse,
  RuleNode,
  StudentRecord,
} from './types'

const GRADE_POINTS: Record<string, number> = {
  'A+': 4, A: 4, 'A-': 3.67, 'B+': 3.33, B: 3, 'B-': 2.67,
  'C+': 2.33, C: 2, 'C-': 1.67, 'D+': 1.33, D: 1, 'D-': 0.67, F: 0,
}

const NON_COUNTING_GRADES = new Set(['F', 'NC', 'Q', 'W', 'X'])

export function gradeSatisfies(grade: string | undefined, min?: string): boolean {
  if (grade === undefined) return true // in progress — counts provisionally
  if (NON_COUNTING_GRADES.has(grade)) return false
  if (!min) return true
  // CR (credit by exam / pass-fail credit) satisfies content requirements
  if (grade === 'CR' || grade === 'I') return true
  const g = GRADE_POINTS[grade]
  const m = GRADE_POINTS[min]
  return g !== undefined && m !== undefined && g >= m
}

/** upper/lower/graduate from the rank digits of a course number */
export function divisionOf(courseId: string): 'lower' | 'upper' | 'graduate' | undefined {
  const m = courseId.match(/ (\d)(\d\d)/)
  if (!m) return undefined
  const rank = parseInt(m[2], 10)
  if (rank <= 19) return 'lower'
  if (rank <= 79) return 'upper'
  return 'graduate'
}

export function subjectOf(courseId: string): string {
  return courseId.replace(/ \d[0-9A-Z]*$/, '')
}

export function courseMatchesFilter(
  c: RecordCourse,
  f: CourseFilter,
  majorSubjects: string[] = [],
): boolean {
  if (f.excludeCourses?.includes(c.id)) return false
  if (f.courses && !f.courses.includes(c.id)) {
    // two-semester halves: "PHL 610QA" matches a filter listing "PHL 610Q"
    const base = c.id.replace(/[AB]$/, '')
    if (!(base !== c.id && f.courses.includes(base))) return false
  }
  if (f.subjects && !f.subjects.includes(subjectOf(c.id))) return false
  if (f.majorField && !majorSubjects.includes(subjectOf(c.id))) return false
  if (f.division && divisionOf(c.id) !== f.division) return false
  return true
}

function countableCourses(record: StudentRecord, includePlanned: boolean): RecordCourse[] {
  return record.courses.filter((c) => {
    if (c.grade !== undefined && NON_COUNTING_GRADES.has(c.grade)) return false
    if (!includePlanned && (c.planned || c.grade === undefined)) return false
    return true
  })
}

export interface EvalOptions {
  /** ids of manual nodes the user has checked off */
  manualChecks?: Set<string>
  /** count planned/in-progress courses (default true) */
  includePlanned?: boolean
}

interface Ctx {
  courses: RecordCourse[]
  manualChecks: Set<string>
  majorSubjects: string[]
}

function evalNode(node: RuleNode, ctx: Ctx): NodeResult {
  switch (node.type) {
    case 'all': {
      const children = node.of.map((ch) => evalNode(ch, ctx))
      const statuses = children.map((r) => r.status)
      let status: NodeStatus
      if (statuses.every((s) => s === 'met')) status = 'met'
      else if (statuses.every((s) => s === 'manual')) status = 'manual'
      else if (statuses.some((s) => s === 'met' || s === 'partial')) status = 'partial'
      else status = 'unmet'
      return {
        node,
        status,
        matched: [],
        deficitHours: umbrellaAwareDeficit(node.of, children),
        children,
      }
    }
    case 'anyN': {
      const children = node.of.map((ch) => evalNode(ch, ctx))
      const metCount = children.filter((r) => r.status === 'met').length
      const met = metCount >= node.n
      // deficit: cheapest way to finish — smallest deficits among unmet
      const unmetDeficits = children
        .filter((r) => r.status !== 'met')
        .map((r) => r.deficitHours)
        .sort((a, b) => a - b)
        .slice(0, Math.max(0, node.n - metCount))
      return {
        node,
        status: met ? 'met' : metCount > 0 || children.some((r) => r.status === 'partial') ? 'partial' : 'unmet',
        matched: [],
        deficitHours: met ? 0 : unmetDeficits.reduce((a, b) => a + b, 0),
        children,
      }
    }
    case 'course': {
      const matched = ctx.courses.filter((c) => {
        const base = c.id.replace(/[AB]$/, '')
        const idMatch = c.id === node.course || (base !== c.id && base === node.course)
        return idMatch && gradeSatisfies(c.grade, node.minGrade)
      })
      const hours = node.course.match(/ (\d)/) ? parseInt(node.course.match(/ (\d)/)![1], 10) : 3
      return {
        node,
        status: matched.length > 0 ? 'met' : 'unmet',
        matched,
        deficitHours: matched.length > 0 ? 0 : hours,
      }
    }
    case 'hours': {
      const eligible = ctx.courses.filter(
        (c) =>
          courseMatchesFilter(c, node.filter, ctx.majorSubjects) &&
          gradeSatisfies(c.grade, node.minGrade) &&
          (!node.inResidence || c.creditType === 'in-residence'),
      )
      let total = 0
      const capUsed = (node.caps ?? []).map(() => 0)
      const matched: RecordCourse[] = []
      for (const c of eligible) {
        let hours = c.hours
        let capped = false
        node.caps?.forEach((cap, i) => {
          if (courseMatchesFilter(c, cap.filter, ctx.majorSubjects)) {
            const room = cap.maxHours - capUsed[i]
            if (room <= 0) capped = true
            else {
              hours = Math.min(hours, room)
              capUsed[i] += hours
            }
          }
        })
        if (capped) continue
        total += hours
        matched.push(c)
      }
      const met = total >= node.hours
      return {
        node,
        status: met ? 'met' : total > 0 ? 'partial' : 'unmet',
        matched,
        deficitHours: Math.max(0, node.hours - total),
      }
    }
    case 'gpa': {
      let points = 0
      let hours = 0
      for (const c of ctx.courses) {
        if (c.grade === undefined || !(c.grade in GRADE_POINTS)) continue
        if (node.scope && !courseMatchesFilter(c, node.scope, ctx.majorSubjects)) continue
        points += GRADE_POINTS[c.grade] * c.hours
        hours += c.hours
      }
      const gpa = hours > 0 ? points / hours : undefined
      const met = gpa === undefined || gpa >= node.min
      return {
        node,
        status: met ? 'met' : 'unmet',
        matched: [],
        deficitHours: 0,
      }
    }
    case 'concentration': {
      // best single field of study: for each subject, progress toward
      // "hours total, upperHours upper-division"; deficit is the max of
      // the two shortfalls (an upper-division course fills both at once)
      const bySubject = new Map<string, RecordCourse[]>()
      for (const c of ctx.courses) {
        if (!gradeSatisfies(c.grade, node.minGrade)) continue
        const subj = subjectOf(c.id)
        if (node.excludeSubjects?.includes(subj)) continue
        if (!bySubject.has(subj)) bySubject.set(subj, [])
        bySubject.get(subj)!.push(c)
      }
      let best: { deficit: number; matched: RecordCourse[] } = {
        deficit: Math.max(node.hours, node.upperHours ?? 0),
        matched: [],
      }
      for (const courses of bySubject.values()) {
        const total = courses.reduce((a, c) => a + c.hours, 0)
        const upper = courses
          .filter((c) => divisionOf(c.id) === 'upper')
          .reduce((a, c) => a + c.hours, 0)
        const deficit = Math.max(
          node.hours - total,
          (node.upperHours ?? 0) - upper,
          0,
        )
        if (deficit < best.deficit) best = { deficit, matched: courses }
      }
      return {
        node,
        status: best.deficit === 0 ? 'met' : best.matched.length > 0 ? 'partial' : 'unmet',
        matched: best.matched,
        deficitHours: best.deficit,
      }
    }
    case 'manual': {
      const checked = node.id !== undefined && ctx.manualChecks.has(node.id)
      return {
        node,
        status: checked ? 'met' : 'manual',
        matched: [],
        deficitHours: 0,
      }
    }
  }
}

/**
 * Sum child deficits, but umbrella nodes ("32 hours of ECO" wrapping named
 * ECO courses) only add whatever their own deficit exceeds the sum of
 * their non-umbrella siblings' — the same future courses fill both.
 */
function umbrellaAwareDeficit(nodes: RuleNode[], results: NodeResult[]): number {
  let specific = 0
  let umbrellaExtra = 0
  results.forEach((r, i) => {
    const isUmbrella = 'umbrella' in nodes[i] && nodes[i].umbrella
    if (isUmbrella) return
    specific += r.deficitHours
  })
  results.forEach((r, i) => {
    const isUmbrella = 'umbrella' in nodes[i] && nodes[i].umbrella
    if (!isUmbrella) return
    umbrellaExtra = Math.max(umbrellaExtra, r.deficitHours - specific)
  })
  return specific + Math.max(0, umbrellaExtra)
}

interface Unit {
  status: NodeStatus
}

/**
 * Scorable units: course/hours/gpa/concentration leaves, each anyN as a
 * single unit. Umbrella aggregates ("120 total hours") are excluded —
 * they'd hand free "met/partial" units to programs whose specific rules
 * didn't extract, and their information lives in remainingHours instead.
 */
function collectUnits(r: NodeResult, out: Unit[]): void {
  const t = r.node.type
  if (r.node.umbrella) return
  if (t === 'anyN' || t === 'course' || t === 'hours' || t === 'gpa' || t === 'concentration' || t === 'manual') {
    out.push({ status: r.status })
    return
  }
  r.children?.forEach((ch) => collectUnits(ch, out))
}

export function auditProgram(
  program: Program,
  layers: Program[],
  record: StudentRecord,
  options: EvalOptions = {},
): ProgramAudit {
  const ctx: Ctx = {
    courses: countableCourses(record, options.includePlanned ?? true),
    manualChecks: options.manualChecks ?? new Set(),
    majorSubjects: program.majorSubjects ?? [],
  }
  const root = evalNode(program.rules, ctx)
  const layerResults = layers.map((layer) => ({
    programId: layer.id,
    root: evalNode(layer.rules, ctx),
  }))

  const units: Unit[] = []
  collectUnits(root, units)
  layerResults.forEach((l) => collectUnits(l.root, units))
  const manualLeaves = units.filter((u) => u.status === 'manual').length
  const scorable = units.filter((u) => u.status !== 'manual')
  const metLeaves = scorable.filter((u) => u.status === 'met').length

  // remaining hours: specific deficits, floored by the program's total-hours
  // requirement against everything the student has earned or planned
  const specific = root.deficitHours + layerResults.reduce((a, l) => a + l.root.deficitHours, 0)
  const earned = ctx.courses.reduce((a, c) => a + c.hours, 0)
  const totalFloor = program.totalHours ? Math.max(0, program.totalHours - earned) : 0
  const remainingHours = Math.max(specific, totalFloor)

  // manual checks count against completeness until the user ticks them —
  // otherwise thinly-extracted programs would rank artificially high
  const denominator = scorable.length + manualLeaves
  return {
    programId: program.id,
    program,
    root,
    layers: layerResults,
    metLeaves,
    totalLeaves: scorable.length,
    manualLeaves,
    remainingHours,
    percentComplete: denominator > 0 ? metLeaves / denominator : 0,
  }
}
