/** Dataset access: fetches the JSON committed under /data (served from the
 * app's public dir), with in-memory caching. */
import type {
  Course,
  CoursesIndex,
  Program,
  ProgramsIndex,
  RuleNode,
  SubjectFile,
} from '../engine/types'

const base = `${import.meta.env.BASE_URL}data`

const cache = new Map<string, Promise<unknown>>()

function fetchJson<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(`${base}/${path}`).then((r) => {
        if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`)
        return r.json()
      }),
    )
  }
  return cache.get(path) as Promise<T>
}

export const EDITIONS = ['2024-26', '2022-24'] as const
export type Edition = (typeof EDITIONS)[number]

/** default catalog edition from the first semester enrolled */
export function editionForFirstSemester(term: string | undefined): Edition {
  const year = term ? parseInt(term.replace(/\D+/g, ''), 10) : NaN
  if (!Number.isNaN(year) && year >= 2024) return '2024-26'
  return '2022-24'
}

export function loadProgramsIndex(edition: string): Promise<ProgramsIndex> {
  return fetchJson(`${edition}/programs-index.json`)
}

interface ListsFile {
  lists: Record<string, string[]>
}

/** named approved-course lists for an edition (missing file → empty). */
async function loadLists(edition: string): Promise<Record<string, string[]>> {
  try {
    const doc = await fetchJson<ListsFile>(`${edition}/lists.json`)
    return doc.lists
  } catch {
    return {}
  }
}

/** expand every filter.list reference into filter.courses, in place. */
function expandLists(node: RuleNode, lists: Record<string, string[]>): void {
  const n = node as { filter?: { list?: string; courses?: string[] }; of?: RuleNode[] }
  const f = n.filter
  if (f?.list && lists[f.list]) {
    f.courses = [...new Set([...(f.courses ?? []), ...lists[f.list]])]
  }
  n.of?.forEach((child) => expandLists(child, lists))
}

export async function loadProgram(edition: string, file: string): Promise<Program> {
  const [program, lists] = await Promise.all([
    fetchJson<Program>(`${edition}/${file}`),
    loadLists(edition),
  ])
  expandLists(program.rules, lists)
  return program
}

export function loadCoursesIndex(edition: string): Promise<CoursesIndex> {
  return fetchJson(`${edition}/courses-index.json`)
}

const subjectSlugCache = new Map<string, Map<string, string>>()

async function subjectSlugs(edition: string): Promise<Map<string, string>> {
  if (!subjectSlugCache.has(edition)) {
    const idx = await loadCoursesIndex(edition)
    subjectSlugCache.set(edition, new Map(idx.subjects.map((s) => [s.code, s.slug])))
  }
  return subjectSlugCache.get(edition)!
}

export async function loadSubject(edition: string, code: string): Promise<SubjectFile | null> {
  const slugs = await subjectSlugs(edition)
  const slug = slugs.get(code)
  if (!slug) return null
  return fetchJson(`${edition}/courses/${slug}.json`)
}

/** look up a single course (handles two-semester A/B half ids) */
export async function findCourse(edition: string, id: string): Promise<Course | null> {
  const subject = id.replace(/ \d[0-9A-Z]*$/, '')
  const file = await loadSubject(edition, subject)
  if (!file) return null
  return file.courses.find((c) => c.id === id) ?? null
}

export async function loadAllPrograms(
  edition: string,
): Promise<{ programs: Program[]; layers: Map<string, Program> }> {
  const idx = await loadProgramsIndex(edition)
  const all = await Promise.all(idx.programs.map((p) => loadProgram(edition, p.file)))
  const layers = new Map(all.filter((p) => p.type === 'layer').map((p) => [p.id, p]))
  return { programs: all.filter((p) => p.type !== 'layer'), layers }
}
