import type { TokenStatus } from '../../shared/types'

export function StatusDot({ status }: { status: TokenStatus }) {
  const color = status === 'ok' ? 'bg-ok' : status === 'needs-login' ? 'bg-warn' : 'bg-crit'
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${color} ${status === 'ok' ? 'animate-pulse-dot' : ''}`}
    />
  )
}
