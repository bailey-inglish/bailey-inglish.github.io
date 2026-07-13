/** Dataset access: fetches the JSON committed under /data (served from the
 * app's public dir), with in-memory caching. */
import type { Course, CoursesIndex, Program, ProgramsIndex, SubjectFile } from '../engine/types'

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

export function loadProgram(edition: string, file: string): Promise<Program> {
  return fetchJson(`${edition}/${file}`)
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
