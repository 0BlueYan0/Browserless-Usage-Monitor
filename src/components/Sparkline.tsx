import { useId } from 'react'
import type { SnapshotPoint } from '../../shared/types'

export function Sparkline({ points, height = 40 }: { points: SnapshotPoint[]; height?: number }) {
  const gradId = useId()
  if (points.length < 2) {
    return (
      <div className="flex h-10 items-center">
        <span className="label">awaiting trend data</span>
      </div>
    )
  }

  const W = 100
  const H = height
  const xs = points.map((p) => p.capturedAt)
  const ys = points.map((p) => p.totalUnits)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const nx = (x: number) => (maxX === minX ? 0 : ((x - minX) / (maxX - minX)) * W)
  const ny = (y: number) => (maxY === minY ? H / 2 : H - 4 - ((y - minY) / (maxY - minY)) * (H - 8))

  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${nx(p.capturedAt).toFixed(2)},${ny(p.totalUnits).toFixed(2)}`)
    .join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-signal)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--color-signal)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={line}
        fill="none"
        stroke="var(--color-signal)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
