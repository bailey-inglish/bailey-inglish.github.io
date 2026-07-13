import { Link } from 'react-router-dom'
import type { ProgramAudit } from '../engine/types'
import { useAudits } from '../state/useAudits'
import { useStore } from '../state/store'

const TYPE_ORDER = ['major', 'minor', 'certificate'] as const
const TYPE_LABEL = { major: 'Majors', minor: 'Minors', certificate: 'Certificates' }

function AuditCard({ audit }: { audit: ProgramAudit }) {
  const { state, toggleMyProgram } = useStore()
  const pct = Math.round(audit.percentComplete * 100)
  const mine = state.myPrograms.includes(audit.programId)
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
        <strong>
          <Link to={`/programs/${encodeURIComponent(audit.programId)}`}>
            {audit.program.name}
          </Link>
        </strong>
        <span className="pill type">
          {audit.program.degreeType ?? audit.program.type}
        </span>
      </div>
      <div className="muted">{audit.program.college}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', margin: '0.5rem 0' }}>
        <div className="progressbar" style={{ flex: 1 }}>
          <div style={{ width: `${pct}%` }} />
        </div>
        <span style={{ fontWeight: 600 }}>{pct}%</span>
      </div>
      <div className="muted">
        {audit.metLeaves}/{audit.totalLeaves} requirements met · ≈{audit.remainingHours} hours
        left
        {audit.manualLeaves > 0 && <> · {audit.manualLeaves} manual check{audit.manualLeaves > 1 ? 's' : ''}</>}
      </div>
      <div style={{ marginTop: '0.5rem' }}>
        <button className={`btn small${mine ? ' primary' : ''}`} onClick={() => toggleMyProgram(audit.programId)}>
          {mine ? '★ In my plan' : '☆ Add to my plan'}
        </button>
      </div>
    </div>
  )
}

export function Rankings() {
  const { state } = useStore()
  const { loading, error, audits } = useAudits()

  if (!state.record) {
    return (
      <>
        <h1>Program rankings</h1>
        <p><Link to="/">Upload your Academic Summary</Link> to see how close you are to every encoded program.</p>
      </>
    )
  }
  if (error) return <div className="violations">Failed to load the dataset: {error}</div>
  if (loading) return <p className="muted">Loading catalog data…</p>

  const sorted = [...audits].sort(
    (a, b) => b.percentComplete - a.percentComplete || a.remainingHours - b.remainingHours,
  )

  return (
    <>
      <h1>Program rankings</h1>
      <p className="muted">
        Every program encoded for the {state.edition} catalog, sorted by how close your
        coursework (including planned courses) gets you. Coverage is growing — see the note
        at the bottom.
      </p>
      {TYPE_ORDER.map((type) => {
        const group = sorted.filter((a) => a.program.type === type)
        if (group.length === 0) return null
        return (
          <section key={type}>
            <h2>{TYPE_LABEL[type]}</h2>
            <div className="grid cols">
              {group.map((a) => <AuditCard key={a.programId} audit={a} />)}
            </div>
          </section>
        )
      })}
      <p className="warnbox" style={{ marginTop: '1.2rem' }}>
        Coverage note: this build includes a first batch of programs (Natural Sciences and
        Liberal Arts focus). The pipeline can encode any catalog program — more batches are
        on the roadmap.
      </p>
    </>
  )
}
