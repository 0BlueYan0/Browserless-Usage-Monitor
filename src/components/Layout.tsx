import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/api'
import { Wordmark } from './Brand'

function navClass({ isActive }: { isActive: boolean }) {
  return [
    'font-mono text-[0.72rem] uppercase tracking-[0.16em] px-3 py-2 rounded-lg transition-colors',
    isActive ? 'text-fg bg-[rgba(148,163,184,0.08)]' : 'text-muted hover:text-fg',
  ].join(' ')
}

export function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const logout = useMutation({
    mutationFn: apiClient.logout,
    onSuccess: async () => {
      await qc.invalidateQueries()
      navigate('/login', { replace: true })
    },
  })

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-[rgba(10,14,20,0.72)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Wordmark />
          <nav className="flex items-center gap-1">
            <NavLink to="/dashboard" className={navClass}>
              Dashboard
            </NavLink>
            <NavLink to="/settings/tokens" className={navClass}>
              Tokens
            </NavLink>
            <button
              type="button"
              onClick={() => logout.mutate()}
              className="ml-1 font-mono text-[0.72rem] uppercase tracking-[0.16em] text-faint transition-colors hover:text-crit"
            >
              Exit
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-7 sm:px-6">{children}</main>
    </div>
  )
}
