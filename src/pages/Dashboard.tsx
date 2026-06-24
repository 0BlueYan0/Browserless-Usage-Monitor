import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/api'
import { fmtDays, fmtPct, fmtUnits, relTime } from '../lib/format'
import { HEALTH_TEXT, healthFromPercent } from '../lib/plans'
import { UsageBar } from '../components/UsageBar'
import { TokenCard } from '../components/TokenCard'
import { StatTile } from '../components/StatTile'

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? 'animate-spin-slow' : ''}
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

export default function Dashboard() {
  const qc = useQueryClient()
  const { data, isLoading, isError, error, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['usage'],
    queryFn: apiClient.usage,
    refetchInterval: 120_000,
  })
  // Refresh pulls fresh data from browserless into D1, then re-reads the cache.
  const refresh = useMutation({
    mutationFn: apiClient.refresh,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['usage'] }),
  })
  const syncing = refresh.isPending || isFetching

  const header = (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <div className="label">Overview</div>
        <h1 className="mt-1 text-xl font-semibold text-fg">Usage across all tokens</h1>
      </div>
      <div className="flex items-center gap-3">
        {dataUpdatedAt > 0 && (
          <span className="hidden font-mono text-[0.6rem] uppercase tracking-wider text-faint sm:inline">
            synced {relTime(dataUpdatedAt)}
          </span>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => refresh.mutate()}
          disabled={syncing}
        >
          <RefreshIcon spinning={syncing} />
          {syncing ? 'Syncing' : 'Refresh'}
        </button>
      </div>
    </div>
  )

  if (isLoading) {
    return (
      <>
        {header}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="panel h-48 animate-pulse-dot" />
          ))}
        </div>
      </>
    )
  }

  if (isError) {
    return (
      <>
        {header}
        <div className="panel p-6 text-sm text-crit">
          Failed to load usage: {(error as Error).message}
        </div>
      </>
    )
  }

  const tokens = data?.tokens ?? []
  const agg = data?.aggregate

  if (tokens.length === 0) {
    return (
      <>
        {header}
        <div className="panel flex flex-col items-center gap-3 p-12 text-center">
          <p className="text-muted">No tokens yet.</p>
          <Link to="/settings/tokens" className="btn btn-primary">
            Add your first token
          </Link>
        </div>
      </>
    )
  }

  const aggHealth = agg ? healthFromPercent(agg.percentUsed) : 'ok'
  const projectedAggPercent =
    agg && agg.totalLimit > 0
      ? (tokens.reduce((s, t) => s + (t.projection?.projectedPeriodTotal ?? 0), 0) / agg.totalLimit) *
        100
      : undefined
  const needAttention = tokens.filter((t) => t.status !== 'ok').length
  const soonestToken = agg?.soonestExhaustionTokenId
    ? tokens.find((t) => t.token.id === agg.soonestExhaustionTokenId)
    : undefined

  return (
    <>
      {header}

      <div className="mb-6 grid gap-4 lg:grid-cols-4">
        <div className="panel p-5 lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <span className="label">Total usage · this period</span>
            <span className={`font-mono text-sm tnum ${HEALTH_TEXT[aggHealth]}`}>
              {agg ? fmtPct(agg.percentUsed) : '—'}
            </span>
          </div>
          <div className="mt-3 font-mono text-3xl tnum text-fg">
            {fmtUnits(agg?.totalUsed ?? 0)}
            <span className="ml-2 text-base text-faint">/ {fmtUnits(agg?.totalLimit ?? 0)} u</span>
          </div>
          <div className="mt-4">
            <UsageBar
              percent={agg?.percentUsed ?? 0}
              projectedPercent={projectedAggPercent}
              health={aggHealth}
              thick
            />
          </div>
        </div>

        <StatTile
          label="Active tokens"
          value={String(tokens.length)}
          sub={
            needAttention > 0 ? (
              <span className="text-warn">{needAttention} need attention</span>
            ) : (
              'all reporting'
            )
          }
        />

        <StatTile
          label="Soonest depletion"
          value={soonestToken ? fmtDays(agg?.soonestDaysRemaining ?? null) : '∞'}
          accent={soonestToken ? 'text-crit' : 'text-ok'}
          sub={soonestToken ? soonestToken.token.label : 'all healthy'}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tokens.map((t, i) => (
          <TokenCard key={t.token.id} data={t} index={i} />
        ))}
      </div>
    </>
  )
}
