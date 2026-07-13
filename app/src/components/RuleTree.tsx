import type { NodeResult } from '../engine/types'

const STATUS_LABEL = { met: 'met', partial: 'partial', unmet: 'not met', manual: 'manual check' }

export function RuleTree({
  result,
  onToggleManual,
  checkedManual,
}: {
  result: NodeResult
  onToggleManual?: (nodeId: string) => void
  checkedManual?: Set<string>
}) {
  return (
    <ul className="ruletree">
      <Node result={result} onToggleManual={onToggleManual} checkedManual={checkedManual} />
    </ul>
  )
}

function Node({
  result,
  onToggleManual,
  checkedManual,
}: {
  result: NodeResult
  onToggleManual?: (nodeId: string) => void
  checkedManual?: Set<string>
}) {
  const { node, status } = result
  const title =
    node.title ??
    (node.type === 'course'
      ? node.course
      : node.type === 'hours'
        ? `${node.hours} hours: ${node.filter.label ?? ''}`
        : node.type === 'gpa'
          ? `GPA ≥ ${node.min.toFixed(2)}`
          : node.type === 'anyN'
            ? `Any ${node.n} of:`
            : node.type === 'manual'
              ? 'Manual check'
              : 'All of:')

  const matched = result.matched.slice(0, 8)
  const isManual = node.type === 'manual'
  const checked = isManual && node.id !== undefined && checkedManual?.has(node.id)

  return (
    <li>
      <div className="nodehead">
        {isManual && node.id !== undefined && onToggleManual ? (
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'baseline' }}>
            <input
              type="checkbox"
              checked={Boolean(checked)}
              onChange={() => onToggleManual(node.id!)}
            />
            <span>{title}</span>
          </label>
        ) : (
          <span>
            {node.type === 'course' && node.minGrade ? `${title} (min ${node.minGrade})` : title}
          </span>
        )}
        <span className={`pill ${status}`}>{STATUS_LABEL[status]}</span>
        {result.deficitHours > 0 && status !== 'met' && (
          <span className="muted">{result.deficitHours}h short</span>
        )}
        {matched.length > 0 && (
          <span className="matched">
            ✓ {matched.map((c) => c.id).join(', ')}
            {result.matched.length > 8 ? '…' : ''}
          </span>
        )}
      </div>
      {isManual && <div className="quote">{node.text}</div>}
      {node.source?.quote && !isManual && <div className="quote">“{node.source.quote}”</div>}
      {result.children && result.children.length > 0 && (
        <ul className="ruletree">
          {result.children.map((ch, i) => (
            <Node
              key={i}
              result={ch}
              onToggleManual={onToggleManual}
              checkedManual={checkedManual}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
