import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseAcademicSummary } from '../lib/summaryParser'
import { extractPdfText } from '../lib/pdfText'
import { useStore, exportStateFile } from '../state/store'

export function Upload() {
  const { state, setRecord, resetAll } = useStore()
  const navigate = useNavigate()
  const [drag, setDrag] = useState(false)
  const [pasted, setPasted] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleText(text: string) {
    const { record, warnings } = parseAcademicSummary(text)
    if (record.courses.length === 0) {
      setError('No courses found — is this an Academic Summary? You can also enter courses manually under “My record”.')
      setWarnings(warnings)
      return
    }
    setError(null)
    setWarnings(warnings)
    setRecord(record)
    navigate('/programs')
  }

  async function handleFile(file: File) {
    setBusy(true)
    setError(null)
    try {
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        let text: string
        try {
          text = await extractPdfText(await file.arrayBuffer())
        } catch (pdfErr) {
          throw new Error(
            `Couldn't read this PDF in your browser (${pdfErr instanceof Error ? pdfErr.message : pdfErr}). ` +
              'As a workaround, open the Academic Summary, select all text (Ctrl/Cmd-A), copy it, ' +
              'and paste it into the box below — that path handles the same data.',
          )
        }
        await handleText(text)
      } else if (file.name.endsWith('.json')) {
        const imported = JSON.parse(await file.text())
        localStorage.setItem('ut-degree-planner-v1', JSON.stringify(imported))
        location.reload()
      } else {
        await handleText(await file.text())
      }
    } catch (e) {
      setError(`Could not read the file: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1>Which UT degrees are you closest to?</h1>
      <p className="muted" style={{ maxWidth: '46rem' }}>
        Upload your <strong>Academic Summary</strong> (Texas One Stop → Student Records →
        View Academic Summary → download as PDF) and this tool audits you against every
        encoded major, minor, and certificate — then helps you plan the remaining
        semesters. Parsing happens entirely in your browser.
      </p>

      <div
        className={`dropzone${drag ? ' drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          const f = e.dataTransfer.files[0]
          if (f) void handleFile(f)
        }}
      >
        <p>Drop your Academic Summary PDF here, or</p>
        <label className="btn primary">
          {busy ? 'Reading…' : 'Choose a file'}
          <input
            type="file"
            accept=".pdf,.txt,.json"
            hidden
            onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])}
          />
        </label>
        <p className="muted" style={{ marginTop: '0.6rem' }}>
          PDF, pasted text, or a previously exported planner JSON
        </p>
      </div>

      <h2>Or paste the text</h2>
      <p className="muted">
        Open the Academic Summary in your browser, select all (Ctrl/Cmd-A), copy, and paste:
      </p>
      <textarea
        value={pasted}
        onChange={(e) => setPasted(e.target.value)}
        placeholder="Academic Summary&#10;EID: ...&#10;Fall 2023 Courses&#10;..."
      />
      <p>
        <button className="btn primary" disabled={!pasted.trim()} onClick={() => void handleText(pasted)}>
          Parse pasted text
        </button>
      </p>

      {error && <div className="violations">{error}</div>}
      {warnings.length > 0 && (
        <div className="warnbox">
          Parsed with {warnings.length} warning{warnings.length > 1 ? 's' : ''}:{' '}
          {warnings.slice(0, 5).join(' · ')}
          {warnings.length > 5 ? ' …' : ''}
        </div>
      )}

      {state.record && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <strong>Current record:</strong> {state.record.courses.length} courses
          {state.record.majors.length > 0 && <> · {state.record.majors.join(' · ')}</>}
          <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="btn small" onClick={() => navigate('/programs')}>View rankings</button>
            <button className="btn small" onClick={() => exportStateFile(state)}>Export data (JSON)</button>
            <button
              className="btn small"
              onClick={() => { if (confirm('Clear the stored record and plan?')) resetAll() }}
            >
              Clear everything
            </button>
          </div>
        </div>
      )}
    </>
  )
}
