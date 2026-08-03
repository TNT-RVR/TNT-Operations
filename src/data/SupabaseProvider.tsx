import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DataContext, type DataContextValue, type NotificationPref } from './context'
import type {
  Field,
  Incubator,
  IncubationBatch,
  IncubatorAlert,
  Inspection,
  Sample,
  SensorReading,
  Tray,
  AppNotification,
  PlacedShelter,
  ShelterTrayLink,
  NestingBlock,
  Grant,
  GrantTask,
} from './types'
import type { CostPrefs } from '@/domain/cost'
import { supabase } from './supabaseClient'
import {
  toField,
  toIncubator,
  toInspection,
  toSensorReading,
  toNotification,
  toSample,
  toTray,
  toBatch,
  toAlert,
  toPlacedShelter,
  toShelterTrayLink,
  toNestingBlock,
  toGrant,
  toGrantTask,
  grantPatch,
  inspectionInsert,
  incubatorUpdate,
  type FieldRow,
  type IncubatorRow,
  type InspectionRow,
  type SensorReadingRow,
  type NotificationRow,
  type SampleRow,
  type TrayRow,
  type BatchRow,
  type AlertRow,
  type PlacedShelterRow,
  type ShelterTrayLinkRow,
  type NestingBlockRow,
  type GrantRow,
  type GrantTaskRow,
} from './mappers'

/**
 * Live Supabase backend. Implements the SAME `DataContextValue` seam as
 * MockProvider (src/data/AppData.tsx) — screens can't tell them apart.
 *
 * Data is hydrated once on mount and held in local state (so `latestReading`
 * stays synchronous, matching the mock). New sensor readings stream in over
 * Realtime; new inspections are inserted and prepended optimistically.
 *
 * NOTE: RLS is keyed to `auth.uid()`, so without a signed-in Supabase Auth
 * session the queries return empty by design. Wiring auth into `useSession()`
 * is the Phase 3 follow-up (see supabase/README.md).
 */
export function SupabaseProvider({ children }: { children: ReactNode }) {
  const [fields, setFields] = useState<Field[]>([])
  const [incubators, setIncubators] = useState<Incubator[]>([])
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [readings, setReadings] = useState<SensorReading[]>([])
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [samples, setSamples] = useState<Sample[]>([])
  const [trays, setTrays] = useState<Tray[]>([])
  const [batches, setBatches] = useState<IncubationBatch[]>([])
  const [alerts, setAlerts] = useState<IncubatorAlert[]>([])
  const [costPrefsByYear, setCostPrefsByYear] = useState<Record<string, Partial<CostPrefs>>>({})
  const [placedShelters, setPlacedShelters] = useState<PlacedShelter[]>([])
  const [shelterTrayLinks, setShelterTrayLinks] = useState<ShelterTrayLink[]>([])
  const [nestingBlocks, setNestingBlocks] = useState<NestingBlock[]>([])
  const [notificationPrefs, setNotificationPrefs] = useState<Record<string, NotificationPref>>({})
  const [grants, setGrants] = useState<Grant[]>([])
  const [grantTasks, setGrantTasks] = useState<GrantTask[]>([])

  // Keep a ref of readings so the realtime handler appends without re-subscribing.
  /** Oldest timestamp already fetched per incubator, so ranges load once. */
  const loadedSinceRef = useRef<Map<string, string>>(new Map())
  const readingsRef = useRef<SensorReading[]>([])
  readingsRef.current = readings
  const notifRef = useRef<AppNotification[]>([])
  notifRef.current = notifications

  useEffect(() => {
    if (!supabase) return
    let cancelled = false

    async function hydrate() {
      const sb = supabase!
      const { data: session } = await sb.auth.getSession()
      if (!session.session) {
        console.warn(
          '[data] Supabase has no signed-in session; RLS will return no rows. ' +
            'Sign-in wiring is the Phase 3 follow-up (see supabase/README.md).',
        )
      }

      const [f, i, insp, notif] = await Promise.all([
        sb.from('shelter_fields').select('*').order('updated_at', { ascending: false }),
        sb.from('incubators').select('*').order('name', { ascending: true }),
        sb.from('inspections').select('*').order('at', { ascending: false }).limit(500),
        sb.from('app_notifications').select('*').is('deleted_at', null).order('created_at', { ascending: false }).limit(200),
      ])
      if (cancelled) return

      if (f.error) console.error('[data] load fields:', f.error.message)
      if (i.error) console.error('[data] load incubators:', i.error.message)
      if (insp.error) console.error('[data] load inspections:', insp.error.message)
      if (notif.error) console.error('[data] load notifications:', notif.error.message)

      const incs = ((i.data as IncubatorRow[]) ?? []).map(toIncubator)
      setFields(((f.data as FieldRow[]) ?? []).map(toField))
      setIncubators(incs)
      setInspections(((insp.data as InspectionRow[]) ?? []).map(toInspection))
      setNotifications(((notif.data as NotificationRow[]) ?? []).map(toNotification))

      // Samples (~61) + batches load whole; trays (~4.6k) exceed PostgREST's
      // 1000-row cap, so page through them.
      const [sm, bt] = await Promise.all([
        sb.from('samples').select('*').order('name', { ascending: true }),
        sb.from('incubation_batches').select('*').order('start_date', { ascending: false, nullsFirst: false }),
      ])
      if (cancelled) return
      if (sm.error) console.error('[data] load samples:', sm.error.message)
      if (bt.error) console.error('[data] load batches:', bt.error.message)
      setSamples(((sm.data as SampleRow[]) ?? []).map(toSample))
      setBatches(((bt.data as BatchRow[]) ?? []).map(toBatch))

      // Incubation alert history (the old app's rules). Newest first, capped —
      // this is a log, so the most recent season is what matters.
      const al = await sb
        .from('alerts')
        .select('*')
        .order('triggered_at', { ascending: false })
        .limit(1000)
      if (cancelled) return
      if (al.error) console.warn('[data] load alerts:', al.error.message)
      else setAlerts(((al.data as AlertRow[]) ?? []).map(toAlert))

      // Cost-estimator pricing forms (one row per year). Missing table (0007
      // not yet applied) degrades to an empty store — the UI uses defaults.
      const cp = await sb.from('cost_prefs').select('*')
      if (cancelled) return
      if (cp.error) console.warn('[data] load cost_prefs:', cp.error.message)
      else {
        const byYear: Record<string, Partial<CostPrefs>> = {}
        for (const row of (cp.data as Array<{ year: string; data: Partial<CostPrefs> }>) ?? []) {
          byYear[row.year] = row.data ?? {}
        }
        setCostPrefsByYear(byYear)
      }

      // Bee lineage (0008): placed shelters + tray links + nesting blocks.
      // Missing tables degrade to empty lists.
      const [ps, stl, nb] = await Promise.all([
        sb.from('placed_shelters').select('*').order('placed_at', { ascending: false }),
        sb.from('shelter_tray_links').select('*'),
        sb.from('nesting_blocks').select('*'),
      ])
      if (cancelled) return
      if (ps.error) console.warn('[data] load placed_shelters:', ps.error.message)
      else setPlacedShelters(((ps.data as PlacedShelterRow[]) ?? []).map(toPlacedShelter))
      if (stl.error) console.warn('[data] load shelter_tray_links:', stl.error.message)
      else setShelterTrayLinks(((stl.data as ShelterTrayLinkRow[]) ?? []).map(toShelterTrayLink))
      if (nb.error) console.warn('[data] load nesting_blocks:', nb.error.message)
      else setNestingBlocks(((nb.data as NestingBlockRow[]) ?? []).map(toNestingBlock))

      // Grants pipeline + their work items (0009).
      const [gr, gt] = await Promise.all([
        sb.from('grants').select('*').order('closes_on', { ascending: true, nullsFirst: false }),
        sb.from('grant_tasks').select('*').order('created_at', { ascending: true }),
      ])
      if (cancelled) return
      if (gr.error) console.warn('[data] load grants:', gr.error.message)
      else setGrants(((gr.data as GrantRow[]) ?? []).map(toGrant))
      if (gt.error) console.warn('[data] load grant_tasks:', gt.error.message)
      else setGrantTasks(((gt.data as GrantTaskRow[]) ?? []).map(toGrantTask))

      // Per-user alert channel prefs (RLS limits to own rows).
      const prefs = await sb.from('app_notification_prefs').select('*')
      if (cancelled) return
      if (prefs.error) console.warn('[data] load notification prefs:', prefs.error.message)
      else {
        const byType: Record<string, NotificationPref> = {}
        for (const row of (prefs.data as Array<{ type: string; in_app: boolean; email: boolean; push: boolean }>) ?? []) {
          byType[row.type] = { inApp: row.in_app, email: row.email, push: row.push }
        }
        setNotificationPrefs(byType)
      }

      const PAGE = 1000
      const allTrays: Tray[] = []
      for (let from = 0; ; from += PAGE) {
        const page = await sb
          .from('trays')
          .select('*')
          .order('tray_number', { ascending: true })
          .range(from, from + PAGE - 1)
        if (cancelled) return
        if (page.error) {
          console.error('[data] load trays:', page.error.message)
          break
        }
        const rows = (page.data as TrayRow[]) ?? []
        allTrays.push(...rows.map(toTray))
        if (rows.length < PAGE) break
      }
      setTrays(allTrays)

      // Readings: PostgREST caps a query at 1000 rows, and there are ~16k, so a
      // single global "recent" query only covers whichever incubators logged most
      // recently. Fetch each incubator's recent window instead — guarantees every
      // card shows its latest reading and every chart has real recent data.
      const perIncubator = await Promise.all(
        incs.map((inc) =>
          sb
            .from('sensor_readings')
            .select('*')
            .eq('incubator_id', inc.id)
            .order('at', { ascending: false })
            .limit(200),
        ),
      )
      if (cancelled) return
      const readings = perIncubator.flatMap((res, idx) => {
        if (res.error) console.error(`[data] load readings[${incs[idx]?.name}]:`, res.error.message)
        return ((res.data as SensorReadingRow[]) ?? []).map(toSensorReading)
      })
      setReadings(readings)
    }

    hydrate()

    // Stream new sensor readings + notifications into local state.
    const channel = supabase
      .channel('tnt_live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sensor_readings' },
        (payload) => {
          const reading = toSensorReading(payload.new as SensorReadingRow)
          if (!readingsRef.current.some((r) => r.id === reading.id)) {
            setReadings((prev) => [reading, ...prev])
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'app_notifications' },
        (payload) => {
          const n = toNotification(payload.new as NotificationRow)
          if (!notifRef.current.some((x) => x.id === n.id)) {
            setNotifications((prev) => [n, ...prev])
          }
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase!.removeChannel(channel)
    }
  }, [])

  const value = useMemo<DataContextValue>(
    () => ({
      fields,
      incubators,
      inspections,
      readings,
      samples,
      trays,
      batches,
      alerts,
      addInspection: (input: Omit<Inspection, 'id'>) => {
        if (!supabase) return
        supabase
          .from('inspections')
          .insert(inspectionInsert(input))
          .select()
          .single()
          .then(({ data, error }) => {
            if (error) {
              console.error('[data] addInspection:', error.message)
              return
            }
            setInspections((prev) => [toInspection(data as InspectionRow), ...prev])
          })
      },
      latestReading: (incubatorId: string) =>
        readings
          .filter((r) => r.incubatorId === incubatorId)
          .sort((a, b) => b.at.localeCompare(a.at))[0],
      loadReadings: async (incubatorId: string, sinceIso: string) => {
        if (!supabase) return
        // Skip if this incubator has already been loaded at least this far back.
        const loadedFrom = loadedSinceRef.current.get(incubatorId)
        if (loadedFrom && loadedFrom <= sinceIso) return
        loadedSinceRef.current.set(incubatorId, sinceIso)

        const PAGE = 1000
        const fetched: SensorReading[] = []
        for (let from = 0; ; from += PAGE) {
          const res = await supabase
            .from('sensor_readings')
            .select('*')
            .eq('incubator_id', incubatorId)
            .gte('at', sinceIso)
            .order('at', { ascending: false })
            .range(from, from + PAGE - 1)
          if (res.error) {
            console.error('[data] loadReadings:', res.error.message)
            loadedSinceRef.current.delete(incubatorId) // let it retry
            return
          }
          const rows = (res.data as SensorReadingRow[]) ?? []
          fetched.push(...rows.map(toSensorReading))
          if (rows.length < PAGE) break
        }

        setReadings((prev) => {
          const seen = new Set(prev.map((r) => r.id))
          const added = fetched.filter((r) => !seen.has(r.id))
          return added.length ? [...added, ...prev] : prev
        })
      },
      saveField: (id: string, patch: Partial<Field>) => {
        if (!supabase) return
        const row: Record<string, unknown> = {}
        if (patch.name !== undefined) row.name = patch.name
        if (patch.client !== undefined) row.client = patch.client
        if (patch.region !== undefined) row.region = patch.region
        if (patch.shapeType !== undefined) row.shape_type = patch.shapeType
        if (patch.shelterCount !== undefined) row.shelter_count = patch.shelterCount
        if (patch.geometry !== undefined) row.data = patch.geometry
        supabase
          .from('shelter_fields')
          .update(row)
          .eq('id', id)
          .select()
          .single()
          .then(({ data, error }) => {
            if (error) {
              console.error('[data] saveField:', error.message)
              return
            }
            setFields((prev) => prev.map((f) => (f.id === id ? toField(data as FieldRow) : f)))
          })
      },
      saveIncubator: (id: string, patch: Partial<Incubator>) => {
        if (!supabase) return
        const row = incubatorUpdate(patch)
        if (Object.keys(row).length === 0) return
        supabase
          .from('incubators')
          .update(row)
          .eq('id', id)
          .select()
          .single()
          .then(({ data, error }) => {
            if (error) {
              console.error('[data] saveIncubator:', error.message)
              return
            }
            setIncubators((prev) => prev.map((i) => (i.id === id ? toIncubator(data as IncubatorRow) : i)))
          })
      },
      assignTray: async ({
        trayNumber,
        sampleId,
        incubatorId,
      }: {
        trayNumber: string
        sampleId: string
        incubatorId: string
      }) => {
        if (!supabase) return { ok: false, created: false, error: 'No backend connection.' }
        const existing = trays.find((t) => t.sampleId === sampleId && t.trayNumber === trayNumber)
        const weight = samples.find((s) => s.id === sampleId)?.lbsPer2Gal ?? null
        const row: Record<string, unknown> = {
          tray_number: trayNumber,
          sample_id: sampleId,
          incubator_id: incubatorId,
          status: 'active',
        }
        // Weight comes from the sample; date is stamped on first use only, so
        // re-scanning a tray to move it doesn't rewrite when it went in.
        if (weight != null) row.weight_lbs = weight
        if (!existing) row.in_date = new Date().toISOString().slice(0, 10)

        // Upsert on the tray's real identity (migration 0010): same sample →
        // update that row (a move), new sample → new row (next season).
        const { data, error } = await supabase
          .from('trays')
          .upsert(row, { onConflict: 'sample_id,tray_number' })
          .select()
          .single()
        if (error) {
          console.error('[data] assignTray:', error.message)
          return { ok: false, created: false, error: error.message }
        }
        const saved = toTray(data as TrayRow)
        setTrays((prev) => {
          const i = prev.findIndex((t) => t.id === saved.id)
          if (i < 0) return [saved, ...prev]
          const next = [...prev]
          next[i] = saved
          return next
        })
        return { ok: true, created: !existing }
      },
      notifications,
      markNotificationsRead: (ids: string[]) => {
        if (!supabase || ids.length === 0) return
        const at = new Date().toISOString()
        setNotifications((prev) => prev.map((n) => (ids.includes(n.id) && !n.readAt ? { ...n, readAt: at } : n)))
        supabase
          .from('app_notifications')
          .update({ read_at: at })
          .in('id', ids)
          .is('read_at', null)
          .then(({ error }) => error && console.error('[data] markNotificationsRead:', error.message))
      },
      markAllNotificationsRead: () => {
        if (!supabase) return
        const at = new Date().toISOString()
        setNotifications((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: at })))
        supabase
          .from('app_notifications')
          .update({ read_at: at })
          .is('read_at', null)
          .is('deleted_at', null)
          .then(({ error }) => error && console.error('[data] markAllNotificationsRead:', error.message))
      },
      deleteNotification: (id: string) => {
        if (!supabase) return
        setNotifications((prev) => prev.filter((n) => n.id !== id))
        supabase
          .from('app_notifications')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', id)
          .then(({ error }) => error && console.error('[data] deleteNotification:', error.message))
      },
      grants,
      addGrant: async (input: Partial<Grant> & { title: string }) => {
        if (!supabase) return ''
        const { data, error } = await supabase
          .from('grants')
          .insert({ source: 'manual', ...grantPatch(input), title: input.title })
          .select()
          .single()
        if (error) {
          console.error('[data] addGrant:', error.message)
          return ''
        }
        const g = toGrant(data as GrantRow)
        setGrants((prev) => [g, ...prev])
        return g.id
      },
      updateGrant: (id: string, patch: Partial<Grant>) => {
        if (!supabase) return
        setGrants((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)))
        supabase
          .from('grants')
          .update(grantPatch(patch))
          .eq('id', id)
          .then(({ error }) => error && console.error('[data] updateGrant:', error.message))
      },
      deleteGrant: (id: string) => {
        if (!supabase) return
        setGrants((prev) => prev.filter((g) => g.id !== id))
        setGrantTasks((prev) => prev.filter((t) => t.grantId !== id))
        supabase
          .from('grants')
          .delete()
          .eq('id', id)
          .then(({ error }) => error && console.error('[data] deleteGrant:', error.message))
      },
      grantTasks,
      addGrantTask: (input: Omit<GrantTask, 'id' | 'createdAt'>) => {
        if (!supabase) return
        supabase
          .from('grant_tasks')
          .insert({ grant_id: input.grantId, title: input.title, status: input.status, assigned_to: input.assignedTo })
          .select()
          .single()
          .then(({ data, error }) => {
            if (error) return console.error('[data] addGrantTask:', error.message)
            setGrantTasks((prev) => [...prev, toGrantTask(data as GrantTaskRow)])
          })
      },
      updateGrantTask: (id: string, patch: Partial<GrantTask>) => {
        if (!supabase) return
        setGrantTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
        const row: Record<string, unknown> = {}
        if (patch.title !== undefined) row.title = patch.title
        if (patch.status !== undefined) row.status = patch.status
        if (patch.assignedTo !== undefined) row.assigned_to = patch.assignedTo
        supabase
          .from('grant_tasks')
          .update(row)
          .eq('id', id)
          .then(({ error }) => error && console.error('[data] updateGrantTask:', error.message))
      },
      deleteGrantTask: (id: string) => {
        if (!supabase) return
        setGrantTasks((prev) => prev.filter((t) => t.id !== id))
        supabase
          .from('grant_tasks')
          .delete()
          .eq('id', id)
          .then(({ error }) => error && console.error('[data] deleteGrantTask:', error.message))
      },
      notificationPrefs,
      saveNotificationPref: (type: string, pref: NotificationPref) => {
        if (!supabase) return
        setNotificationPrefs((prev) => ({ ...prev, [type]: pref }))
        supabase.auth.getUser().then(({ data }) => {
          const uid = data.user?.id
          if (!uid) return
          supabase!
            .from('app_notification_prefs')
            .upsert({ user_id: uid, type, in_app: pref.inApp, email: pref.email, push: pref.push })
            .then(({ error }) => error && console.error('[data] saveNotificationPref:', error.message))
        })
      },
      costPrefsByYear,
      saveCostPrefs: (year: string, prefs: Partial<CostPrefs>) => {
        if (!supabase) return
        setCostPrefsByYear((prev) => ({ ...prev, [year]: prefs }))
        supabase
          .from('cost_prefs')
          .upsert({ year, data: prefs })
          .then(({ error }) => error && console.error('[data] saveCostPrefs:', error.message))
      },
      placedShelters,
      addPlacedShelter: (input: Omit<PlacedShelter, 'id'>) => {
        if (!supabase) return
        supabase
          .from('placed_shelters')
          .insert({
            field_id: input.fieldId,
            qr_code: input.qrCode,
            grid_idx: input.gridIdx,
            lat: input.lat,
            lon: input.lng,
            placed_at: input.placedAt,
            placed_by: input.placedBy,
            status: input.status,
            notes: input.notes,
          })
          .select()
          .single()
          .then(({ data, error }) => {
            if (error) return console.error('[data] addPlacedShelter:', error.message)
            setPlacedShelters((prev) => [toPlacedShelter(data as PlacedShelterRow), ...prev])
          })
      },
      shelterTrayLinks,
      linkTrayToShelter: (input: Omit<ShelterTrayLink, 'id'>) => {
        if (!supabase) return
        supabase
          .from('shelter_tray_links')
          .insert({
            shelter_id: input.shelterId,
            tray_id: input.trayId,
            scanned_at: input.scannedAt,
            scanned_by: input.scannedBy,
          })
          .select()
          .single()
          .then(({ data, error }) => {
            if (error) return console.error('[data] linkTrayToShelter:', error.message)
            setShelterTrayLinks((prev) => [toShelterTrayLink(data as ShelterTrayLinkRow), ...prev])
          })
      },
      nestingBlocks,
      addNestingBlock: (input: Omit<NestingBlock, 'id' | 'createdAt'>) => {
        if (!supabase) return
        supabase
          .from('nesting_blocks')
          .insert({ qr_code: input.qrCode, shelter_id: input.shelterId, notes: input.notes })
          .select()
          .single()
          .then(({ data, error }) => {
            if (error) return console.error('[data] addNestingBlock:', error.message)
            setNestingBlocks((prev) => [toNestingBlock(data as NestingBlockRow), ...prev])
          })
      },
    }),
    [
      fields,
      incubators,
      inspections,
      readings,
      notifications,
      notificationPrefs,
      samples,
      trays,
      batches,
      alerts,
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
