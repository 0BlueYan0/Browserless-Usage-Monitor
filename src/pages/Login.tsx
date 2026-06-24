import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient, ApiError } from '../lib/api'
import { GaugeMark } from '../components/Brand'

export default function Login() {
  const [password, setPassword] = useState('')
  const navigate = useNavigate()
  const qc = useQueryClient()

  const login = useMutation({
    mutationFn: () => apiClient.login(password),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] })
      navigate('/dashboard', { replace: true })
    },
  })

  const errorMsg = login.isError
    ? login.error instanceof ApiError && login.error.status === 401
      ? 'Incorrect password.'
      : (login.error as Error).message
    : null

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form
        className="panel animate-rise w-full max-w-sm p-7"
        onSubmit={(e) => {
          e.preventDefault()
          login.mutate()
        }}
      >
        <div className="flex flex-col items-center text-center">
          <GaugeMark size={44} />
          <div className="mt-3 font-mono text-[0.7rem] tracking-[0.22em] text-muted">BROWSERLESS</div>
          <h1 className="font-mono text-sm tracking-[0.22em] text-fg">USAGE·MONITOR</h1>
        </div>

        {/* Present-but-hidden username helps password managers and accessibility. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          defaultValue="browserless-monitor"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />

        <label className="mt-7 block">
          <span className="label">Dashboard password</span>
          <input
            className="field mt-1"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoFocus
            autoComplete="current-password"
          />
        </label>

        {errorMsg && <p className="mt-3 text-xs text-crit">{errorMsg}</p>}

        <button
          type="submit"
          className="btn btn-primary mt-5 w-full"
          disabled={login.isPending || !password}
        >
          {login.isPending ? 'Authenticating…' : 'Enter'}
        </button>
      </form>
    </div>
  )
}
