import { useMemo, useState, type ReactNode } from 'react'
import { DataContext, type DataContextValue } from './context'
import type { Field, Inspection, SensorReading, AppNotification } from './types'
import { seedFields, seedIncubators, seedInspections, seedReadings, seedNotifications } from './seed'
import { SupabaseProvider } from './SupabaseProvider'
import { isSupabaseConfigured } from './supabaseClient'

let idSeq = 1000
const nextId = (prefix: string) => `${prefix}_${++idSeq}`

/** Mock backend: seeded in-memory state, no server required. */
function MockProvider({ children }: { children: ReactNode }) {
  const [fields, setFields] = useState<Field[]>(seedFields)
  const [inspections, setInspections] = useState<Inspection[]>(seedInspections)
  const [readings] = useState<SensorReading[]>(seedReadings)
  const [notifications, setNotifications] = useState<AppNotification[]>(seedNotifications)
  const nowIso = () => new Date().toISOString()

  const value = useMemo<DataContextValue>(
    () => ({
      fields,
      incubators: seedIncubators,
      inspections,
      readings,
      addInspection: (input) => setInspections((prev) => [{ ...input, id: nextId('in') }, ...prev]),
      latestReading: (incubatorId) =>
        readings
          .filter((r) => r.incubatorId === incubatorId)
          .sort((a, b) => b.at.localeCompare(a.at))[0],
      saveField: (id, patch) =>
        setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f))),
      notifications,
      markNotificationsRead: (ids) =>
        setNotifications((prev) =>
          prev.map((n) => (ids.includes(n.id) && !n.readAt ? { ...n, readAt: nowIso() } : n)),
        ),
      markAllNotificationsRead: () =>
        setNotifications((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: nowIso() }))),
      deleteNotification: (id) => setNotifications((prev) => prev.filter((n) => n.id !== id)),
    }),
    [fields, inspections, readings, notifications],
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

/**
 * Picks the backend from VITE_DATA_SOURCE (`mock` | `supabase`). Falls back to
 * mock — with a warning — when `supabase` is requested but the client isn't
 * configured (missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const source = import.meta.env.VITE_DATA_SOURCE ?? 'mock'
  if (source === 'supabase') {
    if (isSupabaseConfigured) return <SupabaseProvider>{children}</SupabaseProvider>
    console.warn(
      '[data] VITE_DATA_SOURCE=supabase but Supabase is not configured ' +
        '(set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY) — falling back to mock.',
    )
  }
  return <MockProvider>{children}</MockProvider>
}
