import { useState } from 'react'
import type { TokenInput, TokenPublic } from '../../shared/types'
import { apiClient, type TestResult } from '../lib/api'
import { PLAN_TIERS } from '../lib/plans'
import { fmtUnits } from '../lib/format'

function tierLabelFor(limit: number): string {
  const match = PLAN_TIERS.find((t) => t.units === limit)
  return match ? match.label : 'Custom'
}

export function TokenForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial?: TokenPublic
  submitting: boolean
  onSubmit: (input: TokenInput) => void
  onCancel: () => void
}) {
  const editing = !!initial
  const [label, setLabel] = useState(initial?.label ?? '')
  const [source, setSource] = useState<'cloud' | 'self-hosted'>(initial?.source ?? 'cloud')
  const [endpointUrl, setEndpointUrl] = useState(initial?.endpointUrl ?? '')
  const [apiToken, setApiToken] = useState('')
  const [tier, setTier] = useState(initial ? tierLabelFor(initial.planLimit) : 'Free')
  const [planLimit, setPlanLimit] = useState(initial?.planLimit ?? 1000)
  const [resetDay, setResetDay] = useState(initial?.resetDay ?? 1)

  const [test, setTest] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)

  function buildInput(): TokenInput {
    return {
      label: label.trim(),
      source,
      endpointUrl: source === 'self-hosted' ? endpointUrl.trim() : null,
      apiToken: apiToken.trim() || undefined,
      planLimit: Number(planLimit),
      resetDay: Number(resetDay),
    }
  }

  function onTierChange(value: string) {
    setTier(value)
    const t = PLAN_TIERS.find((x) => x.label === value)
    if (t && t.units !== null) setPlanLimit(t.units)
  }

  async function runTest() {
    setTesting(true)
    setTest(null)
    try {
      setTest(await apiClient.testToken(buildInput()))
    } catch (err) {
      setTest({ ok: false, error: (err as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const canTest = !!apiToken.trim() && !!label.trim()

  return (
    <form
      className="panel animate-rise space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(buildInput())
      }}
    >
      <h3 className="font-mono text-sm uppercase tracking-[0.16em] text-fg">
        {editing ? 'Edit token' : 'New token'}
      </h3>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Label</span>
          <input
            className="field mt-1"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="prod-scraper"
            required
          />
        </label>

        <label className="block">
          <span className="label">Source</span>
          <select
            className="field mt-1"
            value={source}
            onChange={(e) => setSource(e.target.value as 'cloud' | 'self-hosted')}
          >
            <option value="cloud">Cloud (browserless.io)</option>
            <option value="self-hosted">Self-hosted fleet</option>
          </select>
        </label>
      </div>

      {source === 'self-hosted' && (
        <label className="block">
          <span className="label">Endpoint URL</span>
          <input
            className="field mt-1"
            value={endpointUrl}
            onChange={(e) => setEndpointUrl(e.target.value)}
            placeholder="https://my-fleet.example.com"
          />
        </label>
      )}

      <label className="block">
        <span className="label">API token{editing && ' (leave blank to keep current)'}</span>
        <input
          className="field mt-1 font-mono"
          type="password"
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
          placeholder={editing ? '••••••••' : 'paste API token'}
          autoComplete="off"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="label">Plan</span>
          <select className="field mt-1" value={tier} onChange={(e) => onTierChange(e.target.value)}>
            {PLAN_TIERS.map((t) => (
              <option key={t.label} value={t.label}>
                {t.label}
                {t.units !== null ? ` · ${fmtUnits(t.units)}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Monthly units</span>
          <input
            className="field mt-1 font-mono tnum"
            type="number"
            min={1}
            value={planLimit}
            disabled={tier !== 'Custom'}
            onChange={(e) => setPlanLimit(Number(e.target.value))}
          />
        </label>
        <label className="block">
          <span className="label">Reset day</span>
          <input
            className="field mt-1 font-mono tnum"
            type="number"
            min={1}
            max={28}
            value={resetDay}
            onChange={(e) => setResetDay(Number(e.target.value))}
          />
        </label>
      </div>

      {test && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            test.ok ? 'border-ok/30 bg-ok/10 text-ok' : 'border-crit/30 bg-crit/10 text-crit'
          }`}
        >
          {test.ok
            ? test.limit != null
              ? `Connection OK · ${fmtUnits(test.used ?? 0)} / ${fmtUnits(test.limit)} units used this period.`
              : `Connection OK · ${fmtUnits(test.weekUnits ?? 0)} units in the last 7 days.`
            : `Failed: ${test.error}`}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <button type="button" className="btn btn-ghost" onClick={runTest} disabled={!canTest || testing}>
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Saving…' : editing ? 'Save changes' : 'Add token'}
          </button>
        </div>
      </div>
    </form>
  )
}
