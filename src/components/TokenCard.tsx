import type { TokenUsage } from '../../shared/types'
import { fmtDays, fmtPct, fmtRate, fmtUnits, daysUntil, relTime } from '../lib/format'
import { HEALTH_TEXT, healthFromProjection, type Health } from '../lib/plans'
import { UsageBar } from './UsageBar'
import { Sparkline } from './Sparkline'
import { StatusDot } from './StatusDot'

function MethodTag({ method }: { method: string }) {
  const text = method === 'burn-rate' ? 'burn-rate' : method === 'linear' ? 'linear' : 'no data'
  return (
    <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider text-faint">
      {text}
    </span>
  )
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={`mt-1 font-mono text-base tnum ${accent ?? 'text-fg'}`}>{value}</div>
    </div>
  )
}

export function TokenCard({ data, index }: { data: TokenUsage; index: number }) {
  const { token, usage, projection, status } = data
  const health: Health = projection ? healthFromProjection(projection) : 'warn'
  const percent = projection ? projection.percentUsed : 0
  const projectedPercent =
    projection && projection.planLimit > 0
      ? (projection.projectedPeriodTotal / projection.planLimit) * 100
      : undefined

  return (
    <div className="panel panel-hover animate-rise p-5" style={{ animationDelay: `${index * 60}ms` }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={status} />
            <h3 className="truncate text-[0.95rem] font-semibold text-fg">{token.label}</h3>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-faint">
              {token.source === 'cloud' ? 'CLOUD' : 'SELF-HOSTED'}
            </span>
            <span className="font-mono text-[0.68rem] text-muted">{token.tokenMask}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`font-mono text-2xl tnum ${HEALTH_TEXT[health]}`}>
            {projection ? fmtPct(percent) : '—'}
          </div>
          <div className="label mt-0.5">used</div>
        </div>
      </div>

      <div className="mt-4">
        <UsageBar percent={percent} projectedPercent={projectedPercent} health={health} />
        <div className="mt-2 flex justify-between font-mono text-xs tnum text-muted">
          <span>{usage ? fmtUnits(usage.totalUnitsUsed) : '—'}</span>
          <span>{fmtUnits(token.planLimit)} u</span>
        </div>
      </div>

      {status === 'needs-login' && (
        <p className="mt-4 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          Token-only usage query failed. Add account login for this token in its settings.
        </p>
      )}
      {status === 'error' && (
        <p className="mt-4 rounded-lg border border-crit/30 bg-crit/10 px-3 py-2 text-xs text-crit">
          {data.error || 'Failed to fetch usage.'}
        </p>
      )}

      {projection && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4">
            <MiniStat
              label="Days left"
              value={fmtDays(projection.daysUntilExhausted)}
              accent={HEALTH_TEXT[health]}
            />
            <MiniStat label="Burn / day" value={`${fmtRate(projection.dailyRate)} u`} />
            <MiniStat
              label="Projected"
              value={`${fmtUnits(projection.projectedPeriodTotal)} u`}
              accent={projection.willExceed ? 'text-crit' : undefined}
            />
            <MiniStat label="Resets in" value={fmtDays(daysUntil(projection.periodEnd))} />
          </div>

          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="label">trend · this period</span>
              <MethodTag method={projection.method} />
            </div>
            <Sparkline points={data.sparkline} />
          </div>
        </>
      )}

      {usage && (
        <div className="mt-3 text-right font-mono text-[0.6rem] uppercase tracking-wider text-faint">
          synced {relTime(usage.fetchedAt)}
        </div>
      )}
    </div>
  )
}
