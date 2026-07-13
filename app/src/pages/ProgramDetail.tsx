import { Link, useParams } from 'react-router-dom'
import { RuleTree } from '../components/RuleTree'
import { useAudits } from '../state/useAudits'
import { useStore } from '../state/store'

export function ProgramDetail() {
  const { programId } = useParams()
  const { state, toggleManualCheck, toggleMyProgram } = useStore()
  const { loading, error, audits, layers } = useAudits()

  if (!state.record) return <p><Link to="/">Upload your Academic Summary</Link> first.</p>
  if (error) return <div className="violations">{error}</div>
  if (loading) return <p className="muted">Loading…</p>

  const audit = audits.find((a) => a.programId === decodeURIComponent(programId ?? ''))
  if (!audit) return <p>Program not found in this catalog edition. <Link to="/programs">Back to rankings</Link></p>

  const checked = new Set(state.manualChecks[audit.programId] ?? [])
  const mine = state.myPrograms.includes(audit.programId)

  return (
    <>
      <p><Link to="/programs">← All programs</Link></p>
      <h1>
        {audit.program.name}{' '}
        <span className="pill type">{audit.program.degreeType ?? audit.program.type}</span>
      </h1>
      <div className="muted">
        {audit.program.college} · {state.edition} catalog ·{' '}
        <a href={audit.program.sourceUrl} target="_blank" rel="noreferrer">catalog page</a>
      </div>

      <div className="card" style={{ marginTop: '0.8rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div className="progressbar" style={{ flex: 1 }}>
            <div style={{ width: `${Math.round(audit.percentComplete * 100)}%` }} />
          </div>
          <strong>{Math.round(audit.percentComplete * 100)}%</strong>
        </div>
        <div className="muted" style={{ marginTop: '0.3rem' }}>
          {audit.metLeaves}/{audit.totalLeaves} requirements met · ≈{audit.remainingHours}{' '}
          hours remaining{audit.manualLeaves > 0 && <> · {audit.manualLeaves} manual checks below</>}
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          <button className={`btn small${mine ? ' primary' : ''}`} onClick={() => toggleMyProgram(audit.programId)}>
            {mine ? '★ In my plan' : '☆ Add to my plan'}
          </button>
        </div>
        {audit.program.notes && <p className="muted" style={{ marginBottom: 0 }}>{audit.program.notes}</p>}
      </div>

      <h2>Program requirements</h2>
      <RuleTree
        result={audit.root}
        checkedManual={checked}
        onToggleManual={(nodeId) => toggleManualCheck(audit.programId, nodeId)}
      />

      {audit.layers.map((layer) => (
        <section key={layer.programId}>
          <h2>{layers.get(layer.programId)?.name ?? layer.programId}</h2>
          <RuleTree
            result={layer.root}
            checkedManual={checked}
            onToggleManual={(nodeId) => toggleManualCheck(audit.programId, nodeId)}
          />
        </section>
      ))}
    </>
  )
}
