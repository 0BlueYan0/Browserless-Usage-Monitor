import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TokenInput, TokenPublic } from '../../shared/types'
import { apiClient } from '../lib/api'
import { fmtUnits } from '../lib/format'
import { TokenForm } from '../components/TokenForm'

export default function SettingsTokens() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['tokens'], queryFn: apiClient.listTokens })
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<TokenPublic | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['tokens'] }),
      qc.invalidateQueries({ queryKey: ['usage'] }),
    ])
  }
  const closeForm = () => {
    setAdding(false)
    setEditing(null)
    setFormError(null)
  }

  const create = useMutation({
    mutationFn: (input: TokenInput) => apiClient.createToken(input),
    onSuccess: async () => {
      await invalidate()
      closeForm()
    },
    onError: (e) => setFormError((e as Error).message),
  })
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: TokenInput }) =>
      apiClient.updateToken(id, input),
    onSuccess: async () => {
      await invalidate()
      closeForm()
    },
    onError: (e) => setFormError((e as Error).message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.deleteToken(id),
    onSuccess: invalidate,
  })

  const tokens = data?.tokens ?? []
  const submitting = create.isPending || update.isPending

  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="label">Settings</div>
          <h1 className="mt-1 text-xl font-semibold text-fg">Tokens</h1>
        </div>
        {!adding && !editing && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            + Add token
          </button>
        )}
      </div>

      {formError && (
        <div className="mb-4 rounded-lg border border-crit/30 bg-crit/10 px-3 py-2 text-xs text-crit">
          {formError}
        </div>
      )}

      {(adding || editing) && (
        <div className="mb-6">
          <TokenForm
            initial={editing ?? undefined}
            submitting={submitting}
            onCancel={closeForm}
            onSubmit={(input) => {
              setFormError(null)
              if (editing) update.mutate({ id: editing.id, input })
              else create.mutate(input)
            }}
          />
        </div>
      )}

      {isLoading ? (
        <div className="panel h-32 animate-pulse-dot" />
      ) : tokens.length === 0 && !adding ? (
        <div className="panel p-10 text-center text-muted">No tokens configured yet.</div>
      ) : (
        <div className="space-y-2">
          {tokens.map((t) => (
            <div
              key={t.id}
              className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold text-fg">{t.label}</span>
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-faint">
                    {t.source === 'cloud' ? 'CLOUD' : 'SELF-HOSTED'}
                  </span>
                  {t.hasAccountLogin && (
                    <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[0.55rem] uppercase tracking-wider text-muted">
                      login
                    </span>
                  )}
                </div>
                <div className="mt-0.5 font-mono text-xs text-muted">
                  {t.tokenMask} · {fmtUnits(t.planLimit)} u/mo · resets day {t.resetDay}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setEditing(t)
                    setAdding(false)
                    setFormError(null)
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (confirm(`Delete token "${t.label}"? This also removes its history.`)) {
                      remove.mutate(t.id)
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
