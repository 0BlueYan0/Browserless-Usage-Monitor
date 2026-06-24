const numberFormat = new Intl.NumberFormat('en-US')

export function fmtUnits(n: number): string {
  return numberFormat.format(Math.round(n))
}

export function fmtCompact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function fmtPct(p: number): string {
  if (!Number.isFinite(p)) return '—'
  return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`
}

export function fmtDays(d: number | null): string {
  if (d === null) return '∞'
  if (d <= 0) return '0d'
  if (d < 1) return `${Math.round(d * 24)}h`
  return `${d < 10 ? d.toFixed(1) : Math.round(d)}d`
}

export function fmtRate(perDay: number): string {
  if (!Number.isFinite(perDay) || perDay <= 0) return '0'
  return perDay < 10 ? perDay.toFixed(1) : fmtUnits(perDay)
}

export function relTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 0) return 'just now'
  const s = Math.floor(diff / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function daysUntil(ms: number): number {
  return Math.max(0, (ms - Date.now()) / (24 * 60 * 60 * 1000))
}
