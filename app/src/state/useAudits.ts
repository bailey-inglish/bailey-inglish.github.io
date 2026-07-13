import { useEffect, useMemo, useState } from 'react'
import { auditProgram } from '../engine/evaluate'
import type { Program, ProgramAudit } from '../engine/types'
import { loadAllPrograms } from '../lib/data'
import { useStore } from './store'

export interface AuditsState {
  loading: boolean
  error: string | null
  audits: ProgramAudit[]
  programs: Map<string, Program>
  layers: Map<string, Program>
}

/** Load the edition's programs and audit the current record against all. */
export function useAudits(): AuditsState {
  const { state } = useStore()
  const [data, setData] = useState<{ programs: Program[]; layers: Map<string, Program> } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    loadAllPrograms(state.edition)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [state.edition])

  const audits = useMemo(() => {
    if (!data || !state.record) return []
    return data.programs.map((program) => {
      const layerProgs = (program.includes ?? [])
        .map((id) => data.layers.get(id))
        .filter((p): p is Program => Boolean(p))
      return auditProgram(program, layerProgs, state.record!, {
        manualChecks: new Set(state.manualChecks[program.id] ?? []),
      })
    })
  }, [data, state.record, state.manualChecks])

  return {
    loading: !data && !error,
    error,
    audits,
    programs: new Map((data?.programs ?? []).map((p) => [p.id, p])),
    layers: data?.layers ?? new Map(),
  }
}
