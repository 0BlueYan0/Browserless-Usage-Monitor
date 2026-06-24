import { describe, expect, it } from 'vitest'
import {
  burnRateFromSnapshots,
  computePeriod,
  computeProjection,
  normalizeResetDay,
} from './projection'

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)

describe('normalizeResetDay', () => {
  it('clamps to 1..28', () => {
    expect(normalizeResetDay(0)).toBe(1)
    expect(normalizeResetDay(31)).toBe(28)
    expect(normalizeResetDay(15)).toBe(15)
    expect(normalizeResetDay(Number.NaN)).toBe(1)
  })
})

describe('computePeriod', () => {
  it('reset day 1 within the month', () => {
    const { start, end } = computePeriod(1, utc(2026, 6, 24))
    expect(start).toBe(utc(2026, 6, 1))
    expect(end).toBe(utc(2026, 7, 1))
  })

  it('reset day mid-month, now after reset day', () => {
    const { start, end } = computePeriod(15, utc(2026, 6, 24))
    expect(start).toBe(utc(2026, 6, 15))
    expect(end).toBe(utc(2026, 7, 15))
  })

  it('reset day mid-month, now before reset day rolls back a month', () => {
    const { start, end } = computePeriod(15, utc(2026, 6, 10))
    expect(start).toBe(utc(2026, 5, 15))
    expect(end).toBe(utc(2026, 6, 15))
  })

  it('rolls across the year boundary', () => {
    const { start, end } = computePeriod(10, utc(2026, 1, 5))
    expect(start).toBe(utc(2025, 12, 10))
    expect(end).toBe(utc(2026, 1, 10))
  })
})

describe('burnRateFromSnapshots', () => {
  const periodStart = utc(2026, 6, 1)
  const now = utc(2026, 6, 11)

  it('returns null with fewer than 2 points in period', () => {
    expect(burnRateFromSnapshots([], periodStart, now)).toBeNull()
    expect(
      burnRateFromSnapshots([{ capturedAt: utc(2026, 6, 9), totalUnits: 100 }], periodStart, now),
    ).toBeNull()
  })

  it('computes units/day over the span', () => {
    const rate = burnRateFromSnapshots(
      [
        { capturedAt: utc(2026, 6, 9), totalUnits: 100 },
        { capturedAt: utc(2026, 6, 11), totalUnits: 300 },
      ],
      periodStart,
      now,
    )
    expect(rate).toBe(100) // 200 units over 2 days
  })

  it('ignores points before the period start', () => {
    const rate = burnRateFromSnapshots(
      [
        { capturedAt: utc(2026, 5, 20), totalUnits: 9999 },
        { capturedAt: utc(2026, 6, 9), totalUnits: 100 },
        { capturedAt: utc(2026, 6, 11), totalUnits: 300 },
      ],
      periodStart,
      now,
    )
    expect(rate).toBe(100)
  })

  it('returns null when the counter goes backwards', () => {
    const rate = burnRateFromSnapshots(
      [
        { capturedAt: utc(2026, 6, 9), totalUnits: 300 },
        { capturedAt: utc(2026, 6, 11), totalUnits: 100 },
      ],
      periodStart,
      now,
    )
    expect(rate).toBeNull()
  })
})

describe('computeProjection', () => {
  it('linear: projects from usage so far, not exhausting before period end', () => {
    const p = computeProjection({
      planLimit: 5000,
      used: 1000,
      resetDay: 1,
      now: utc(2026, 6, 11),
    })
    expect(p.method).toBe('linear')
    expect(p.dailyRate).toBeCloseTo(100, 6) // 1000 / 10 days
    expect(p.remaining).toBe(4000)
    expect(p.percentUsed).toBeCloseTo(20, 6)
    expect(p.willExceed).toBe(false)
    expect(p.daysUntilExhausted).toBeNull()
  })

  it('linear: flags exhaustion within the period', () => {
    const p = computeProjection({
      planLimit: 1000,
      used: 500,
      resetDay: 1,
      now: utc(2026, 6, 11),
    })
    expect(p.dailyRate).toBeCloseTo(50, 6)
    expect(p.willExceed).toBe(true)
    expect(p.daysUntilExhausted).toBeCloseTo(10, 6)
    expect(p.exhaustionDate).toBe(utc(2026, 6, 21))
  })

  it('prefers burn-rate when snapshots are available', () => {
    const p = computeProjection({
      planLimit: 5000,
      used: 300,
      resetDay: 1,
      now: utc(2026, 6, 11),
      snapshots: [
        { capturedAt: utc(2026, 6, 9), totalUnits: 100 },
        { capturedAt: utc(2026, 6, 11), totalUnits: 300 },
      ],
    })
    expect(p.method).toBe('burn-rate')
    expect(p.dailyRate).toBe(100)
  })

  it('handles being over the limit', () => {
    const p = computeProjection({
      planLimit: 5000,
      used: 6000,
      resetDay: 1,
      now: utc(2026, 6, 11),
    })
    expect(p.remaining).toBe(0)
    expect(p.percentUsed).toBeCloseTo(120, 6)
    expect(p.daysUntilExhausted).toBe(0)
  })

  it('no usage yet -> method none, no exhaustion', () => {
    const p = computeProjection({
      planLimit: 5000,
      used: 0,
      resetDay: 1,
      now: utc(2026, 6, 11),
    })
    expect(p.method).toBe('none')
    expect(p.dailyRate).toBe(0)
    expect(p.daysUntilExhausted).toBeNull()
    expect(p.willExceed).toBe(false)
  })
})
