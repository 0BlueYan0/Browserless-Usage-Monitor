import type { TokenInput, TokenPublic, UsageResponse } from '../../shared/types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || res.statusText)
  }
  return data as T
}

export interface TestResult {
  ok: boolean
  used?: number | null
  limit?: number | null
  weekUnits?: number
  error?: string
}

export const apiClient = {
  me: async (): Promise<{ authenticated: boolean }> => {
    try {
      return await api<{ authenticated: boolean }>('/api/auth/me')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return { authenticated: false }
      throw err
    }
  },
  login: (password: string) =>
    api<{ ok: true }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => api<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  listTokens: () => api<{ tokens: TokenPublic[] }>('/api/tokens'),
  createToken: (input: TokenInput) =>
    api<{ token: TokenPublic }>('/api/tokens', { method: 'POST', body: JSON.stringify(input) }),
  updateToken: (id: string, input: TokenInput) =>
    api<{ token: TokenPublic }>(`/api/tokens/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteToken: (id: string) => api<{ ok: true }>(`/api/tokens/${id}`, { method: 'DELETE' }),
  testToken: (input: TokenInput) =>
    api<TestResult>('/api/tokens/test', { method: 'POST', body: JSON.stringify(input) }),
  usage: () => api<UsageResponse>('/api/usage'),
  // Refresh a single token only — per-token buttons avoid bursting browserless
  // when many tokens are configured.
  refreshToken: (id: string) =>
    api<{ ok: true }>(`/api/refresh/${id}`, { method: 'POST' }),
}
