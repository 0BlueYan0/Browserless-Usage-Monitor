import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeQuotaExhausted } from './browserless'

const mockFetch = (impl: () => Promise<Response>) => vi.stubGlobal('fetch', vi.fn(impl))

afterEach(() => vi.unstubAllGlobals())

describe('probeQuotaExhausted', () => {
  it('returns true on 401 with the usage-limit message', async () => {
    mockFetch(async () =>
      new Response(
        "You've reached the units usage limit allowed under our free plan, please upgrade to a paid plan",
        { status: 401 },
      ),
    )
    expect(await probeQuotaExhausted('tok')).toBe(true)
  })

  it('returns null on 401 with any other message', async () => {
    mockFetch(async () => new Response('Unauthorized', { status: 401 }))
    expect(await probeQuotaExhausted('tok')).toBeNull()
  })

  it('returns false on 200', async () => {
    mockFetch(async () => new Response('{}', { status: 200 }))
    expect(await probeQuotaExhausted('tok')).toBe(false)
  })

  it('returns null when the request throws', async () => {
    mockFetch(async () => {
      throw new Error('network down')
    })
    expect(await probeQuotaExhausted('tok')).toBeNull()
  })
})
