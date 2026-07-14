/**
 * Core data model shared by the dataset (/data), the audit engine, and the UI.
 *
 * Design notes:
 * - Requirement rules form a tree of RuleNodes. Nodes are evaluated
 *   independently against the full course record: a course may satisfy
 *   several nodes at once. This mirrors how "umbrella" catalog rules work
 *   ("at least 32 hours of economics, consisting of ...") — the named
 *   courses intrinsically also count toward the umbrella hour total.
 * - Umbrella nodes are flagged so proximity scoring doesn't double-count
 *   their deficit against their siblings'.
 * - Anything the pipeline could not formalize is a `manual` node carrying
 *   the verbatim catalog text; it renders as a user-checkable item and is
 *   excluded from automatic scoring, never silently dropped.
 * - Every node may carry `source` (catalog URL + verbatim quote) for
 *   auditability.
 */

// ---------- Courses ----------

export type Division = 'lower' | 'upper' | 'graduate'

export interface Course {
  id: string // "ECO 304K" — subject code + number, canonical form
  subject: string
  number: string
  title: string
  hours: number
  division: Division
  description?: string
  tccn?: string // Texas Common Course Numbering (transfer mapping)
  prereqText?: string
  prereq?: PrereqNode
  prereqConfidence?: 'high' | 'low' | 'none'
  sameAs?: string // cross-listing prose, e.g. "Sociology 302K"
  restricted?: string // "Restricted to students in the College of ..."
  excluded?: string // "May not be counted by students with credit for ..."
  offering?: string // "Offered in the fall semester only."
}

export type PrereqNode =
  | { type: 'course'; id: string; minGrade?: string }
  | { type: 'all'; of: PrereqNode[] }
  | { type: 'any'; of: PrereqNode[] }

export interface SubjectFile {
  code: string
  name: string
  courses: Course[]
}

export interface CoursesIndex {
  edition: string
  subjects: { code: string; name: string; slug: string; count: number }[]
  totalCourses: number
}

// ---------- Requirement rules ----------

export interface CourseFilter {
  /** subject codes, e.g. ["ECO"] */
  subjects?: string[]
  /** explicit course ids that match */
  courses?: string[]
  /** course ids that never match */
  excludeCourses?: string[]
  division?: 'lower' | 'upper'
  /**
   * matches courses in the audited program's major field — resolved from
   * Program.majorSubjects at evaluation time, so shared layers can say
   * "advanced coursework in the major" generically
   */
  majorField?: boolean
  /**
   * named approved-course list (see data/<edition>/lists.json) — e.g. the
   * College of Liberal Arts "social science field" list. Expanded into
   * `courses` when the program is loaded, so many programs can share one
   * authoritative list without duplicating it.
   */
  list?: string
  /** human description shown in the UI for placeholder slots */
  label?: string
}

export interface SourceRef {
  url: string
  /** verbatim quote from the catalog page */
  quote?: string
}

interface NodeBase {
  /** stable id within the program, for manual-check state + limits */
  id?: string
  title?: string
  source?: SourceRef
  /**
   * Umbrella rules overlap their siblings ("at least 32 hours of ECO"
   * alongside the named ECO courses). Their remaining-hours deficit is
   * reduced by what sibling deficits already cover.
   */
  umbrella?: boolean
}

export type RuleNode =
  | (NodeBase & { type: 'all'; of: RuleNode[] })
  /** at least n of the children must be satisfied */
  | (NodeBase & { type: 'anyN'; n: number; of: RuleNode[] })
  | (NodeBase & {
      type: 'course'
      course: string
      minGrade?: string
      /** if false, cross-listings / equivalents don't satisfy it */
      allowEquivalents?: boolean
    })
  | (NodeBase & {
      type: 'hours'
      hours: number
      filter: CourseFilter
      minGrade?: string
      /** caps like "no more than 6 hours of X may be counted" */
      caps?: { filter: CourseFilter; maxHours: number; note?: string }[]
      /** only in-residence (non-transfer, non-exam) hours count */
      inResidence?: boolean
    })
  | (NodeBase & {
      type: 'gpa'
      min: number
      /** omitted scope = overall UT GPA */
      scope?: CourseFilter
    })
  /**
   * "N hours, including M upper-division, in a single field of study
   * (other than X)" — evaluated by finding the best-progress subject
   */
  | (NodeBase & {
      type: 'concentration'
      hours: number
      upperHours?: number
      excludeSubjects?: string[]
      /**
       * restrict the "single field" to one subject from this pool — e.g.
       * "N hours in a single foreign language" (one of the language
       * subjects), rather than any field of study
       */
      includeSubjects?: string[]
      minGrade?: string
    })
  | (NodeBase & { type: 'manual'; text: string })
  /**
   * Informational catalog prose that is NOT a checkable requirement —
   * advisor-approval steps, enrollment policies, dates, and the like.
   * Rendered as muted context; never scored, never a manual check.
   */
  | (NodeBase & { type: 'note'; text: string })

// ---------- Programs ----------

export type ProgramType = 'major' | 'minor' | 'certificate' | 'layer'

export interface Program {
  /** e.g. "2022-24/major/bs-statistics-and-data-science" */
  id: string
  edition: string
  type: ProgramType
  name: string
  college: string
  /** BA, BS, BSA, BBA, ... absent for minors/certificates/layers */
  degreeType?: string
  totalHours?: number
  /**
   * subject codes that constitute "the major field" for this program —
   * resolves majorField filters in this program's rules and its layers
   */
  majorSubjects?: string[]
  /**
   * Shared requirement layers this program builds on, by program id —
   * e.g. the university core curriculum, or "BA Plan I degree requirements".
   * Layers are programs with type "layer".
   */
  includes?: string[]
  rules: RuleNode
  /** catalog page this program was extracted from */
  sourceUrl: string
  notes?: string
  /** produced by the automatic extractor (vs hand-curated) */
  auto?: boolean
}

export interface ProgramsIndex {
  edition: string
  programs: {
    id: string
    type: ProgramType
    name: string
    college: string
    degreeType?: string
    file: string
  }[]
}

// ---------- Student record ----------

export type CreditType =
  | 'in-residence'
  | 'credit-by-exam'
  | 'transfer'
  | 'extension'
  | 'correspondence'

export interface RecordCourse {
  /** canonical id, e.g. "ECO 304K" */
  id: string
  title?: string
  /** term label, e.g. "Fall 2023"; planned courses use future terms */
  term: string
  hours: number
  /** letter grade, "CR" (credit), "F", or undefined while in progress */
  grade?: string
  creditType: CreditType
  /** true for user-added planned (not yet taken) courses */
  planned?: boolean
  uniqueNumber?: string
}

export interface StudentRecord {
  name?: string
  eid?: string
  majors: string[] // raw major strings from the summary
  schools: string[]
  classification?: string
  firstSemester?: string
  lastSemester?: string
  courses: RecordCourse[]
  totals?: {
    lowerDivisionHours?: number
    upperDivisionHours?: number
    overallHours?: number
    overallGpa?: number
  }
  /** catalog edition the student is audited under */
  edition?: string
}

// ---------- Audit results ----------

export type NodeStatus = 'met' | 'partial' | 'unmet' | 'manual' | 'note'

export interface NodeResult {
  node: RuleNode
  status: NodeStatus
  /** courses from the record that counted toward this node */
  matched: RecordCourse[]
  /** hours still missing (0 when met; heuristic for anyN) */
  deficitHours: number
  children?: NodeResult[]
}

export interface ProgramAudit {
  programId: string
  program: Program
  root: NodeResult
  /** results for included layers (core, degree rules), audited separately */
  layers: { programId: string; root: NodeResult }[]
  metLeaves: number
  totalLeaves: number
  manualLeaves: number
  /** heuristic remaining semester hours, umbrella-aware */
  remainingHours: number
  percentComplete: number
}
