import { useEffect, useState } from 'react'
import type { Course } from '../engine/types'
import { loadCoursesIndex, loadSubject } from '../lib/data'

/** Search box over the edition's course DB ("SDS 3", "govern", "M 408"). */
export function CourseSearch({
  edition,
  onPick,
}: {
  edition: string
  onPick: (course: Course) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Course[]>([])

  useEffect(() => {
    let cancelled = false
    const q = query.trim().toUpperCase()
    if (q.length < 2) {
      setResults([])
      return
    }
    void (async () => {
      const idx = await loadCoursesIndex(edition)
      // subject-prefix query ("SDS 3", "C S 314") → search that subject;
      // otherwise match subject names and load those (bounded)
      const m = q.match(/^([A-Z][A-Z &]{0,5}?)\s*(\d[0-9A-Z]*)?$/)
      let codes: string[] = []
      if (m && idx.subjects.some((s) => s.code === m[1].trim())) {
        codes = [m[1].trim()]
      } else {
        codes = idx.subjects
          .filter((s) => s.name.toUpperCase().includes(q) || s.code === q)
          .slice(0, 3)
          .map((s) => s.code)
      }
      const files = await Promise.all(codes.map((c) => loadSubject(edition, c)))
      if (cancelled) return
      const numPrefix = m?.[2] ?? ''
      const out: Course[] = []
      for (const f of files) {
        if (!f) continue
        for (const c of f.courses) {
          if (numPrefix && !c.number.startsWith(numPrefix)) continue
          if (!numPrefix && !m && !c.title.toUpperCase().includes(q)) continue
          out.push(c)
          if (out.length >= 30) break
        }
      }
      setResults(out)
    })()
    return () => { cancelled = true }
  }, [query, edition])

  return (
    <div>
      <input
        type="text"
        placeholder="Search courses (e.g. SDS 3, M 408, Government)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: '100%' }}
      />
      {results.length > 0 && (
        <div className="searchresults">
          {results.map((c) => (
            <button key={c.id} onClick={() => { onPick(c); setQuery('') }}>
              <strong>{c.id}</strong> · {c.title} · {c.hours}h
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
