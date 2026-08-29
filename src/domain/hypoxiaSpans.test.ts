/**
 * Purge and maintenance spans, the part of the chart that carries the meaning.
 *
 * A hypoxia trace is a sawtooth — oxygen creeps up as the chamber leaks, a
 * purge drops it, repeat. Drawn without the purges marked, that reads as a
 * chamber repeatedly failing. The spans are what turn it into the mechanism
 * working, so getting them wrong is worse than not drawing them.
 *
 * `collapseSpans` lives in the domain and is imported by BOTH the chart and
 * this test, so what is asserted here is what actually draws. A copy of the
 * loop pasted into the test would pass while the chart did something else —
 * which is the failure mode this whole file exists to prevent.
 */
import { describe, expect, it } from 'vitest'
import { collapseSpans } from './hypoxia'

const t = (min: number) => new Date(Date.UTC(2026, 7, 29, 12, min)).toISOString()
const idle = (min: number) => ({ at: t(min), purging: false, maintenance: false })
const purge = (min: number) => ({ at: t(min), purging: true, maintenance: false })
const maint = (min: number) => ({ at: t(min), purging: false, maintenance: true })

describe('collapseSpans', () => {
  it('finds nothing in a quiet stretch', () => {
    expect(collapseSpans([idle(0), idle(5), idle(10)])).toEqual([])
  })

  /*
   * The reason this collapses at all: one rect per READING would stripe the
   * chart at the poll rate instead of showing how long the chamber actually
   * purged for.
   */
  it('collapses consecutive purging readings into one span', () => {
    const spans = collapseSpans([idle(0), purge(5), purge(10), purge(15), idle(20)])
    expect(spans).toEqual([{ start: t(5), end: t(20), kind: 'purge' }])
  })

  it('keeps separate purges separate', () => {
    const spans = collapseSpans([purge(0), idle(5), purge(10), idle(15)])
    expect(spans).toHaveLength(2)
    expect(spans.every((s) => s.kind === 'purge')).toBe(true)
  })

  // Different meanings, different shading — they must not merge into one band.
  it('does not run a purge and a maintenance stretch together', () => {
    const spans = collapseSpans([purge(0), purge(5), maint(10), maint(15), idle(20)])
    expect(spans).toEqual([
      { start: t(0), end: t(10), kind: 'purge' },
      { start: t(10), end: t(20), kind: 'maint' },
    ])
  })

  // A chamber still purging at the right-hand edge of the window.
  it('closes a span that is still open at the end', () => {
    const spans = collapseSpans([idle(0), purge(5), purge(10)])
    expect(spans).toEqual([{ start: t(5), end: t(10), kind: 'purge' }])
  })

  it('handles a window that is entirely one state', () => {
    expect(collapseSpans([maint(0), maint(5)])).toEqual([{ start: t(0), end: t(5), kind: 'maint' }])
  })

  // The firmware sets purge and maint independently; purging is the more
  // specific thing to say about that moment.
  it('calls a reading that is both purging and in maintenance a purge', () => {
    const both = { at: t(0), purging: true, maintenance: true }
    expect(collapseSpans([both, idle(5)])).toEqual([{ start: t(0), end: t(5), kind: 'purge' }])
  })

  it('copes with an empty window', () => {
    expect(collapseSpans([])).toEqual([])
  })
})
