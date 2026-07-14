import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { RecordCourse } from '../engine/types'
import { termIndex, nextTermId } from '../lib/planner'
import { CourseSearch } from '../components/CourseSearch'
import { useStore } from '../state/store'

const GRADES = ['', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F', 'CR']

export function RecordEditor() {
  const { state, updateCourses } = useStore()
  const record = state.record
  const [addTerm, setAddTerm] = useState<string>('')

  const terms = useMemo(() => {
    if (!record) return []
    const seen = new Map<string, RecordCourse[]>()
    for (const c of [...record.courses].sort((a, b) => termIndex(a.term) - termIndex(b.term))) {
      if (!seen.has(c.term)) seen.set(c.term, [])
      seen.get(c.term)!.push(c)
    }
    return [...seen.entries()]
  }, [record])

  if (!record) {
    return (
      <>
        <h1>My record</h1>
        <p>
          No record yet — <Link to="/">upload your Academic Summary</Link> first, or start
          from scratch by adding planned courses here once a record exists.
        </p>
      </>
    )
  }

  function mutate(fn: (courses: RecordCourse[]) => RecordCourse[]) {
    updateCourses(fn([...record!.courses]))
  }

  const lastTerm = record.courses.reduce(
    (best, c) => (termIndex(c.term) > termIndex(best) ? c.term : best),
    record.courses[0]?.term ?? 'Spring 2026',
  )
  const termOptions = [lastTerm, ...Array.from({ length: 9 }, (_, i) =>
    Array.from({ length: i + 1 }).reduce<string>((t) => nextTermId(t, true), lastTerm),
  )]

  return (
    <>
      <h1>My record</h1>
      <div className="card">
        {record.name && <div><strong>{record.name}</strong> {record.eid && <span className="muted">({record.eid})</span>}</div>}
        {record.majors.length > 0 && (
          <div className="muted">Majors on record: {record.majors.join(' · ')}</div>
        )}
        <div className="muted">
          {record.courses.length} courses ·{' '}
          {record.courses.reduce((a, c) => a + c.hours, 0)} hours
          {record.totals?.overallGpa !== undefined && <> · GPA {record.totals.overallGpa.toFixed(2)}</>}
          {' '}· catalog {state.edition}
        </div>
      </div>

      {terms.map(([term, courses]) => (
        <div key={term} className="card">
          <h2 style={{ margin: '0 0 0.5rem' }}>{term}</h2>
          <table className="courses">
            <thead>
              <tr><th>Course</th><th>Title</th><th>Grade</th><th>Hours</th><th>Type</th><th /></tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={`${c.id}-${c.term}-${c.uniqueNumber ?? ''}`}>
                  <td><strong>{c.id}</strong>{c.planned && <span className="pill manual" style={{ marginLeft: 6 }}>planned</span>}</td>
                  <td className="muted">{c.title ?? ''}</td>
                  <td>
                    <select
                      value={c.grade ?? ''}
                      onChange={(e) =>
                        mutate((cs) =>
                          cs.map((x) => (x === c ? { ...x, grade: e.target.value || undefined } : x)),
                        )
                      }
                    >
                      {GRADES.map((g) => (
                        <option key={g} value={g}>{g === '' ? 'in progress' : g}</option>
                      ))}
                    </select>
                  </td>
                  <td>{c.hours}</td>
                  <td className="muted">{c.creditType}</td>
                  <td>
                    <button
                      className="btn small"
                      onClick={() => mutate((cs) => cs.filter((x) => x !== c))}
                      aria-label={`Remove ${c.id}`}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <h2>Add a course</h2>
      <div className="card">
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
          <label className="muted">
            Term{' '}
            <select value={addTerm || lastTerm} onChange={(e) => setAddTerm(e.target.value)}>
              {termOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <span className="muted">Courses in future terms are treated as planned.</span>
        </div>
        <CourseSearch
          edition={state.edition}
          onPick={(course) => {
            const term = addTerm || lastTerm
            const planned = termIndex(term) > termIndex(lastTerm)
            mutate((cs) => [
              ...cs,
              {
                id: course.id,
                title: course.title,
                term,
                hours: course.hours,
                grade: undefined,
                creditType: 'in-residence',
                planned,
              },
            ])
          }}
        />
      </div>
    </>
  )
}
