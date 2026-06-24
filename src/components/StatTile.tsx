import type { ReactNode } from 'react'

export function StatTile({
  label,
  value,
  sub,
  accent,
  className = '',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  accent?: string
  className?: string
}) {
  return (
    <div className={`panel p-4 ${className}`}>
      <div className="label">{label}</div>
      <div className={`mt-2 font-mono text-2xl tnum ${accent ?? 'text-fg'}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  )
}
