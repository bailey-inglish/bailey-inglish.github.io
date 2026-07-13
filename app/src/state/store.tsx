/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { RecordCourse, StudentRecord } from '../engine/types'
import { editionForFirstSemester } from '../lib/data'
import type { Edition } from '../lib/data'
import { defaultTerms } from '../lib/planner'
import type { PlanItem, PlanTerm } from '../lib/planner'

export interface AppState {
  record: StudentRecord | null
  edition: Edition
  /** program id -> checked manual-node ids */
  manualChecks: Record<string, string[]>
  /** program ids the student is pursuing (drives the planner) */
  myPrograms: string[]
  terms: PlanTerm[]
  planItems: PlanItem[]
}

const STORAGE_KEY = 'ut-degree-planner-v1'

const initial: AppState = {
  record: null,
  edition: '2024-26',
  manualChecks: {},
  myPrograms: [],
  terms: [],
  planItems: [],
}

interface StoreApi {
  state: AppState
  setRecord: (record: StudentRecord | null) => void
  setEdition: (edition: Edition) => void
  toggleManualCheck: (programId: string, nodeId: string) => void
  toggleMyProgram: (programId: string) => void
  updateCourses: (courses: RecordCourse[]) => void
  setTerms: (terms: PlanTerm[]) => void
  setPlanItems: (items: PlanItem[]) => void
  resetAll: () => void
}

const Ctx = createContext<StoreApi | null>(null)

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...initial, ...JSON.parse(raw) }
  } catch {
    /* corrupted state — start fresh */
  }
  return initial
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* storage full/unavailable — the app still works, just not persisted */
    }
  }, [state])

  const setRecord = useCallback((record: StudentRecord | null) => {
    setState((s) => ({
      ...s,
      record,
      edition: record ? editionForFirstSemester(record.firstSemester) : s.edition,
      terms: s.terms.length > 0 ? s.terms : defaultTerms(record?.lastSemester),
    }))
  }, [])

  const api = useMemo<StoreApi>(
    () => ({
      state,
      setRecord,
      setEdition: (edition) => setState((s) => ({ ...s, edition })),
      toggleManualCheck: (programId, nodeId) =>
        setState((s) => {
          const cur = new Set(s.manualChecks[programId] ?? [])
          if (cur.has(nodeId)) cur.delete(nodeId)
          else cur.add(nodeId)
          return { ...s, manualChecks: { ...s.manualChecks, [programId]: [...cur] } }
        }),
      toggleMyProgram: (programId) =>
        setState((s) => ({
          ...s,
          myPrograms: s.myPrograms.includes(programId)
            ? s.myPrograms.filter((id) => id !== programId)
            : [...s.myPrograms, programId],
        })),
      updateCourses: (courses) =>
        setState((s) => (s.record ? { ...s, record: { ...s.record, courses } } : s)),
      setTerms: (terms) => setState((s) => ({ ...s, terms })),
      setPlanItems: (planItems) => setState((s) => ({ ...s, planItems })),
      resetAll: () => setState(initial),
    }),
    [state, setRecord],
  )

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useStore(): StoreApi {
  const api = useContext(Ctx)
  if (!api) throw new Error('useStore outside provider')
  return api
}

/** export/import the whole state as a JSON file (device-to-device moves) */
export function exportStateFile(state: AppState): void {
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'ut-degree-planner.json'
  a.click()
  URL.revokeObjectURL(url)
}
