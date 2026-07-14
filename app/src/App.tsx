import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { StoreProvider, useStore } from './state/store'
import { Upload } from './pages/Upload'
import { RecordEditor } from './pages/RecordEditor'
import { Rankings } from './pages/Rankings'
import { ProgramDetail } from './pages/ProgramDetail'
import { Planner } from './pages/Planner'

function Shell() {
  const { state, setEdition } = useStore()
  return (
    <>
      <nav className="topnav">
        <NavLink to="/" className="brand">UT Degree Planner</NavLink>
        <NavLink to="/record" className={({ isActive }) => `nav${isActive ? ' active' : ''}`}>
          My record
        </NavLink>
        <NavLink to="/programs" className={({ isActive }) => `nav${isActive ? ' active' : ''}`}>
          Program rankings
        </NavLink>
        <NavLink to="/planner" className={({ isActive }) => `nav${isActive ? ' active' : ''}`}>
          Planner
        </NavLink>
        <span className="spacer" />
        <label className="muted">
          Catalog{' '}
          <select
            value={state.edition}
            onChange={(e) => setEdition(e.target.value as typeof state.edition)}
          >
            <option value="2024-26">2024–2026</option>
            <option value="2022-24">2022–2024</option>
          </select>
        </label>
      </nav>
      <div className="disclaimer">
        Unofficial planning tool — not affiliated with UT Austin. Your official degree audit
        (IDA) and academic advisor are authoritative. Data is parsed from the public UT
        catalogs and may contain errors; always confirm against the linked catalog page.
      </div>
      <main>
        <Routes>
          <Route path="/" element={<Upload />} />
          <Route path="/record" element={<RecordEditor />} />
          <Route path="/programs" element={<Rankings />} />
          <Route path="/programs/:programId" element={<ProgramDetail />} />
          <Route path="/planner" element={<Planner />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer>
        Everything runs in your browser — your transcript never leaves this device. Dataset
        built from the{' '}
        <a href="https://catalog.utexas.edu/" target="_blank" rel="noreferrer">
          UT Austin catalogs
        </a>
        .
      </footer>
    </>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </StoreProvider>
  )
}
