import type { Health } from '../lib/plans'

const GRADIENT: Record<Health, string> = {
  ok: 'linear-gradient(90deg, var(--color-brand), var(--color-signal))',
  warn: 'linear-gradient(90deg, #f59e0b, var(--color-warn))',
  crit: 'linear-gradient(90deg, #e11d48, var(--color-crit))',
}

export function UsageBar({
  percent,
  projectedPercent,
  health,
  thick = false,
}: {
  percent: number
  projectedPercent?: number
  health: Health
  thick?: boolean
}) {
  const fill = Math.min(100, Math.max(0, percent))
  const showMarker =
    projectedPercent !== undefined && projectedPercent > percent && projectedPercent <= 100
  return (
    <div
      className={`relative w-full overflow-hidden rounded-full bg-[rgba(148,163,184,0.1)] ${
        thick ? 'h-3' : 'h-2'
      }`}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{ width: `${fill}%`, background: GRADIENT[health] }}
      />
      {showMarker && (
        <div
          className="absolute top-0 h-full w-px bg-fg/70"
          style={{ left: `${Math.min(100, projectedPercent!)}%` }}
          title="Projected end-of-period usage"
        />
      )}
    </div>
  )
}
