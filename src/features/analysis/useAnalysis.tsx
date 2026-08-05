/**
 * Shared filter state and derived data for the Analysis section.
 *
 * Replaces the Base44 app's two separate contexts (GlobalFilterContext for
 * year/company/crop, SettingsContext for the exclusion toggles) with one, since
 * every screen used both and they were always read together.
 *
 * The filters persist per device so someone comparing 2024 across three tabs
 * doesn't reset them on every navigation. They are NOT in the URL — that was
 * considered and dropped: the exclusion toggles change what a correlation
 * means, and a shared link that silently carried "hail seasons included" would
 * be worse than no link at all.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useData } from '@/data/context'
import type { FieldAnalysis } from '@/data/types'

const STORAGE_KEY = 'tnt.analysis.filters.v1'

export interface AnalysisFilters {
  year: string
  company: string
  crop: string
  /** Seasons ruined by weather say nothing about how the operation was run. */
  excludeHail: boolean
  /** Rows the office flagged as mis-recorded. */
  excludeBadRecording: boolean
  /** Deliberate trials — real data, but not the standard practice. */
  excludeExperimental: boolean
}

const DEFAULTS: AnalysisFilters = {
  year: 'all',
  company: 'all',
  crop: 'all',
  // Default to the honest view: exclusions ON. A hailed-out field is a story
  // about weather, not about shelter placement, and leaving those rows in is
  // what makes "more shelters, worse return" look true.
  excludeHail: true,
  excludeBadRecording: true,
  excludeExperimental: true,
}

interface AnalysisContextValue {
  filters: AnalysisFilters
  setFilter: <K extends keyof AnalysisFilters>(key: K, value: AnalysisFilters[K]) => void
  resetFilters: () => void
  /** Every row, unfiltered. */
  allRows: FieldAnalysis[]
  /** Rows passing the current filters — what every chart should plot. */
  rows: FieldAnalysis[]
  loading: boolean
  /** Distinct values for the pickers, from the unfiltered set. */
  years: string[]
  companies: string[]
  crops: string[]
  /** How many rows the exclusion toggles are currently holding back. */
  excludedCount: number
}

const AnalysisContext = createContext<AnalysisContextValue | null>(null)

function readStored(): AnalysisFilters {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AnalysisFilters>) }
  } catch {
    return DEFAULTS
  }
}

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const { fieldAnalysis, fieldAnalysisLoading, loadFieldAnalysis } = useData()
  const [filters, setFilters] = useState<AnalysisFilters>(readStored)

  useEffect(() => {
    void loadFieldAnalysis()
  }, [loadFieldAnalysis])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filters))
    } catch {
      // A device that refuses storage still gets working filters, just not
      // remembered ones.
    }
  }, [filters])

  const setFilter = useCallback(
    <K extends keyof AnalysisFilters>(key: K, value: AnalysisFilters[K]) => {
      setFilters((prev) => ({ ...prev, [key]: value }))
    },
    [],
  )

  const resetFilters = useCallback(() => setFilters(DEFAULTS), [])

  const value = useMemo<AnalysisContextValue>(() => {
    const allRows = fieldAnalysis

    const distinct = (pick: (r: FieldAnalysis) => string) =>
      [...new Set(allRows.map(pick).filter(Boolean))].sort()

    const rows = allRows.filter((r) => {
      if (filters.year !== 'all' && r.year !== filters.year) return false
      if (filters.company !== 'all' && r.company !== filters.company) return false
      if (filters.crop !== 'all' && r.crop !== filters.crop) return false
      if (filters.excludeHail && r.hail_damage) return false
      if (filters.excludeBadRecording && r.bad_recording) return false
      if (filters.excludeExperimental && r.experimental) return false
      return true
    })

    // Only the exclusion toggles, so the count means "rows held back as
    // unrepresentative" rather than "rows not matching your year filter".
    const excludedCount = allRows.filter(
      (r) =>
        (filters.excludeHail && r.hail_damage) ||
        (filters.excludeBadRecording && r.bad_recording) ||
        (filters.excludeExperimental && r.experimental),
    ).length

    return {
      filters,
      setFilter,
      resetFilters,
      allRows,
      rows,
      loading: fieldAnalysisLoading,
      years: distinct((r) => r.year).reverse(),
      companies: distinct((r) => r.company),
      crops: distinct((r) => r.crop),
      excludedCount,
    }
  }, [fieldAnalysis, fieldAnalysisLoading, filters, setFilter, resetFilters])

  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>
}

export function useAnalysis(): AnalysisContextValue {
  const ctx = useContext(AnalysisContext)
  if (!ctx) throw new Error('useAnalysis must be used within an AnalysisProvider')
  return ctx
}

/**
 * Stable colour index for a company.
 *
 * Derived from its position in the FULL company list, not the filtered one, so
 * narrowing to two companies leaves both the colours they had before.
 */
export function useCompanyIndex(): (company: string) => number {
  const { allRows } = useAnalysis()
  return useMemo(() => {
    const order = [...new Set(allRows.map((r) => r.company).filter(Boolean))].sort()
    const index = new Map(order.map((c, i) => [c, i]))
    return (company: string) => index.get(company) ?? order.length
  }, [allRows])
}
