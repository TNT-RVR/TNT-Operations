import { useMemo, useState, type ReactNode } from 'react'
import { DataContext, type DataContextValue, type NotificationPref } from './context'
import type {
  Field,
  Incubator,
  Inspection,
  SensorReading,
  AppNotification,
  PlacedShelter,
  ShelterTrayLink,
  NestingBlock,
  Grant,
  GrantTask,
} from './types'
import type { CostPrefs } from '@/domain/cost'
import {
  seedFields,
  seedIncubators,
  seedInspections,
  seedReadings,
  seedNotifications,
  seedSamples,
  seedTrays,
  seedBatches,
  seedAlerts,
  seedGrants,
} from './seed'
import { SupabaseProvider } from './SupabaseProvider'
import { isSupabaseConfigured } from './supabaseClient'

let idSeq = 1000
const nextId = (prefix: string) => `${prefix}_${++idSeq}`

/** Mock backend: seeded in-memory state, no server required. */
function MockProvider({ children }: { children: ReactNode }) {
  const [fields, setFields] = useState<Field[]>(seedFields)
  const [incubators, setIncubators] = useState<Incubator[]>(seedIncubators)
  const [inspections, setInspections] = useState<Inspection[]>(seedInspections)
  const [readings] = useState<SensorReading[]>(seedReadings)
  const [notifications, setNotifications] = useState<AppNotification[]>(seedNotifications)
  const [costPrefsByYear, setCostPrefsByYear] = useState<Record<string, Partial<CostPrefs>>>({})
  const [placedShelters, setPlacedShelters] = useState<PlacedShelter[]>([])
  const [shelterTrayLinks, setShelterTrayLinks] = useState<ShelterTrayLink[]>([])
  const [nestingBlocks, setNestingBlocks] = useState<NestingBlock[]>([])
  const [notificationPrefs, setNotificationPrefs] = useState<Record<string, NotificationPref>>({})
  const [grants, setGrants] = useState<Grant[]>(seedGrants)
  const [grantTasks, setGrantTasks] = useState<GrantTask[]>([])
  const nowIso = () => new Date().toISOString()

  const value = useMemo<DataContextValue>(
    () => ({
      fields,
      incubators,
      inspections,
      readings,
      samples: seedSamples,
      trays: seedTrays,
      batches: seedBatches,
      alerts: seedAlerts,
      addInspection: (input) => setInspections((prev) => [{ ...input, id: nextId('in') }, ...prev]),
      latestReading: (incubatorId) =>
        readings
          .filter((r) => r.incubatorId === incubatorId)
          .sort((a, b) => b.at.localeCompare(a.at))[0],
      // Mock holds every seeded reading already — nothing to fetch.
      loadReadings: async () => {},
      saveField: (id, patch) =>
        setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f))),
      saveIncubator: (id, patch) =>
        setIncubators((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i))),
      notifications,
      markNotificationsRead: (ids) =>
        setNotifications((prev) =>
          prev.map((n) => (ids.includes(n.id) && !n.readAt ? { ...n, readAt: nowIso() } : n)),
        ),
      markAllNotificationsRead: () =>
        setNotifications((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: nowIso() }))),
      deleteNotification: (id) => setNotifications((prev) => prev.filter((n) => n.id !== id)),
      notificationPrefs,
      saveNotificationPref: (type, pref) => setNotificationPrefs((prev) => ({ ...prev, [type]: pref })),
      costPrefsByYear,
      saveCostPrefs: (year, prefs) => setCostPrefsByYear((prev) => ({ ...prev, [year]: prefs })),
      placedShelters,
      addPlacedShelter: (input) => setPlacedShelters((prev) => [{ ...input, id: nextId('ps') }, ...prev]),
      shelterTrayLinks,
      linkTrayToShelter: (input) => setShelterTrayLinks((prev) => [{ ...input, id: nextId('stl') }, ...prev]),
      nestingBlocks,
      addNestingBlock: (input) =>
        setNestingBlocks((prev) => [{ ...input, id: nextId('nb'), createdAt: nowIso() }, ...prev]),
      grants,
      addGrant: (input) => {
        const id = nextId('g')
        const grant: Grant = {
          funder: null,
          url: null,
          status: 'new',
          amountMin: null,
          amountMax: null,
          eligibilitySummary: null,
          summary: null,
          notesMd: null,
          opensOn: null,
          closesOn: null,
          region: null,
          categories: [],
          assignedTo: null,
          source: 'manual',
          ...input,
          id,
          createdAt: nowIso(),
        }
        setGrants((prev) => [grant, ...prev])
        return id
      },
      updateGrant: (id, patch) => setGrants((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g))),
      deleteGrant: (id) => {
        setGrants((prev) => prev.filter((g) => g.id !== id))
        setGrantTasks((prev) => prev.filter((t) => t.grantId !== id))
      },
      grantTasks,
      addGrantTask: (input) =>
        setGrantTasks((prev) => [...prev, { ...input, id: nextId('gt'), createdAt: nowIso() }]),
      updateGrantTask: (id, patch) =>
        setGrantTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t))),
      deleteGrantTask: (id) => setGrantTasks((prev) => prev.filter((t) => t.id !== id)),
    }),
    [
      fields,
      incubators,
      inspections,
      readings,
      notifications,
      notificationPrefs,
      costPrefsByYear,
      placedShelters,
      shelterTrayLinks,
      nestingBlocks,
      grants,
      grantTasks,
    ],
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
