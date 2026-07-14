import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import type { PrereqNode } from '../engine/types'
import { loadSubject } from '../lib/data'
import {
  autoArrange,
  nextTermId,
  suggestionsFromAudit,
  termIndex,
  validatePlan,
} from '../lib/planner'
import type { PlanItem, PlanTerm, Violation } from '../lib/planner'
import { useAudits } from '../state/useAudits'
import { useStore } from '../state/store'

const POOL = '__pool__'

function DraggableItem({ item, violation }: { item: PlanItem; violation?: Violation }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.key,
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`courseitem${item.courseId ? '' : ' placeholder'}${violation ? ' violation' : ''}`}
      style={{
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        opacity: isDragging ? 0.6 : 1,
      }}
      title={violation?.message}
    >
      <span>{item.label}</span>
      <span className="muted">{item.hours}h</span>
    </div>
  )
}

function TermColumn({
  term,
  items,
  violations,
  onConfigure,
  onRemove,
}: {
  term: PlanTerm
  items: PlanItem[]
  violations: Violation[]
  onConfigure: (t: PlanTerm) => void
  onRemove: () => void
}) {
  const { isOver, setNodeRef } = useDroppable({ id: term.id })
  const hours = items.reduce((a, it) => a + it.hours, 0)
  const overloaded = violations.some((v) => v.termId === term.id && v.kind === 'overload')
  return (
    <div ref={setNodeRef} className={`termcol${isOver ? ' over' : ''}${term.kind === 'abroad' ? ' abroad' : ''}`}>
      <h3>
        {term.id}
        <button className="btn small" onClick={onRemove} aria-label={`Remove ${term.id}`}>✕</button>
      </h3>
      <div className="meta">
        <span style={overloaded ? { color: 'var(--unmet)', fontWeight: 600 } : undefined}>
          {hours}/{term.maxHours}h
        </span>
        <select
          value={term.kind}
          onChange={(e) => onConfigure({ ...term, kind: e.target.value as PlanTerm['kind'] })}
        >
          <option value="long">on campus</option>
          <option value="summer">summer</option>
          <option value="abroad">study abroad</option>
        </select>
        <input
          type="number"
          min={1}
          max={21}
          value={term.maxHours}
          style={{ width: '3.6rem' }}
          onChange={(e) => onConfigure({ ...term, maxHours: parseInt(e.target.value || '17', 10) })}
          aria-label="max hours"
        />
      </div>
      {items.map((it) => (
        <DraggableItem
          key={it.key}
          item={it}
          violation={violations.find((v) => v.itemKey === it.key)}
        />
      ))}
    </div>
  )
}

export function Planner() {
  const { state, setTerms, setPlanItems } = useStore()
  const { loading, audits } = useAudits()
  const [prereqs, setPrereqs] = useState<Map<string, PrereqNode>>(new Map())

  const myAudits = audits.filter((a) => state.myPrograms.includes(a.programId))

  // load prereq ASTs for all concrete courses in the plan
  useEffect(() => {
    const ids = state.planItems.map((it) => it.courseId).filter((id): id is string => Boolean(id))
    const subjects = [...new Set(ids.map((id) => id.replace(/ \d[0-9A-Z]*$/, '')))]
    let cancelled = false
    void Promise.all(subjects.map((s) => loadSubject(state.edition, s))).then((files) => {
      if (cancelled) return
      const map = new Map<string, PrereqNode>()
      for (const f of files) {
        for (const c of f?.courses ?? []) {
          if (c.prereq) map.set(c.id, c.prereq)
        }
      }
      setPrereqs(map)
    })
    return () => { cancelled = true }
  }, [state.planItems, state.edition])

  const prereqOf = useMemo(() => (id: string) => prereqs.get(id), [prereqs])

  const violations = useMemo(
    () =>
      state.record
        ? validatePlan(state.planItems, state.terms, state.record, prereqOf)
        : [],
    [state.planItems, state.terms, state.record, prereqOf],
  )

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor))

  if (!state.record) {
    return <p><Link to="/">Upload your Academic Summary</Link> to start planning.</p>
  }

  function refreshSuggestions() {
    const roots = myAudits.flatMap((a) => [a.root, ...a.layers.map((l) => l.root)])
    const fresh = suggestionsFromAudit(roots)
    // keep placements for items that still exist
    const placed = new Map(state.planItems.map((it) => [it.key, it.termId]))
    setPlanItems(fresh.map((it) => ({ ...it, termId: placed.get(it.key) ?? null })))
  }

  function handleDragEnd(e: DragEndEvent) {
    const itemKey = String(e.active.id)
    const target = e.over ? String(e.over.id) : null
    if (!target) return
    setPlanItems(
      state.planItems.map((it) =>
        it.key === itemKey ? { ...it, termId: target === POOL ? null : target } : it,
      ),
    )
  }

  const lastPlanned =
    state.terms.length > 0
      ? state.terms.reduce((best, t) => (termIndex(t.id) > termIndex(best.id) ? t : best)).id
      : (state.record.lastSemester ?? 'Spring 2026')

  const pool = state.planItems.filter((it) => it.termId === null)
  const sortedTerms = [...state.terms].sort((a, b) => termIndex(a.id) - termIndex(b.id))

  return (
    <>
      <h1>Semester planner</h1>
      {myAudits.length === 0 && (
        <p className="warnbox">
          Star programs on the <Link to="/programs">rankings page</Link> (“Add to my plan”)
          and their unmet requirements will appear here as schedulable items.
        </p>
      )}
      {violations.length > 0 && (
        <div className="violations">
          {violations.slice(0, 6).map((v, i) => <div key={i}>⚠ {v.message}</div>)}
          {violations.length > 6 && <div>…and {violations.length - 6} more</div>}
        </div>
      )}
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="planner">
          <div>
            <div className="card">
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <button className="btn small primary" onClick={refreshSuggestions} disabled={myAudits.length === 0}>
                  Suggest from my programs
                </button>
                <button
                  className="btn small"
                  disabled={state.planItems.length === 0 || state.terms.length === 0}
                  onClick={() =>
                    setPlanItems(autoArrange(state.planItems, state.terms, state.record!, prereqOf))
                  }
                >
                  Auto-arrange
                </button>
                <button
                  className="btn small"
                  onClick={() =>
                    setTerms([
                      ...state.terms,
                      { id: nextTermId(lastPlanned, true), kind: 'long', maxHours: 17 },
                    ])
                  }
                >
                  + Term
                </button>
              </div>
              <p className="muted" style={{ marginBottom: 0 }}>
                Drag items between semesters. Set a term to “study abroad” to reserve it for
                transfer-credit placeholders. Prerequisite chains are checked live from the
                catalog’s course data.
              </p>
            </div>
            <PoolColumn items={pool} violations={violations} />
          </div>
          <div className="termgrid">
            {sortedTerms.map((t) => (
              <TermColumn
                key={t.id}
                term={t}
                items={state.planItems.filter((it) => it.termId === t.id)}
                violations={violations}
                onConfigure={(nt) => setTerms(state.terms.map((x) => (x.id === t.id ? nt : x)))}
                onRemove={() => {
                  setTerms(state.terms.filter((x) => x.id !== t.id))
                  setPlanItems(
                    state.planItems.map((it) => (it.termId === t.id ? { ...it, termId: null } : it)),
                  )
                }}
              />
            ))}
            {sortedTerms.length === 0 && !loading && (
              <p className="muted">Add a term to begin.</p>
            )}
          </div>
        </div>
      </DndContext>
    </>
  )
}

function PoolColumn({ items, violations }: { items: PlanItem[]; violations: Violation[] }) {
  const { isOver, setNodeRef } = useDroppable({ id: POOL })
  return (
    <div ref={setNodeRef} className={`termcol${isOver ? ' over' : ''}`}>
      <h3>Unscheduled</h3>
      <div className="meta">{items.length} items</div>
      {items.map((it) => (
        <DraggableItem key={it.key} item={it} violation={violations.find((v) => v.itemKey === it.key)} />
      ))}
      {items.length === 0 && <p className="muted">Nothing waiting — nice.</p>}
    </div>
  )
}
