import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CrewTask } from '@/domain/supplies'
import { DataContext, type DataContextValue, type NotificationPref, type TrayObservation } from './context'
import type {
  FieldChecklistCell,
  Block,
  BlockPlacement,
  Field,
  Incubator,
  IncubationBatch,
  IncubatorAlert,
  Inspection,
  TrayInspection,
  Sample,
  SensorReading,
  Tray,
  AppNotification,
  PlacedShelter,
  ShelterTrayLink,
  NestingBlock,
  BlockSeason,
  Grant,
  GrantTask,
  FieldAnalysis,
  FieldWeather,
  CalendarEvent,
} from './types'
import type { CostPrefs } from '@/domain/cost'
import { planJoin, planTakeLead, type Crew, type CrewMember } from '@/domain/crews'
import { parseAnalysisCsvRow } from '@/domain/analysisImport'
import { summariseWeather, weatherKey, type OpenMeteoDaily } from '@/domain/weather'
import { useSalesSupabase } from './useSalesSupabase'
import { useTasksSupabase } from './useTasksSupabase'
import { useSettings } from './useSettings'
import { supabase } from './supabaseClient'

/** Cached Open-Meteo response, as stored by migration 0014. */
interface WeatherCacheRow {
  lat_key: number | string
  lng_key: number | string
  year: string
  daily: unknown
}
import {
  toFieldChecklistCell,
  toBlock,
  toBlockPlacement,
  toField,
  toIncubator,
  toInspection,
  toSensorReading,
  toIncubatorModeEvent,
  toNotification,
  toSample,
  toTray,
  toBatch,
  toAlert,
  toTrayInspection,
  toPlacedShelter,
  toShelterTrayLink,
  toNestingBlock,
  toGrant,
  toGrantTask,
  grantPatch,
  inspectionInsert,
  incubatorUpdate,
  samplePatch,
  type BlockRow,
  type BlockPlacementRow,
  type FieldRow,
  type IncubatorRow,
  type InspectionRow,
  type SensorReadingRow,
  type IncubatorModeEventRow,
  type NotificationRow,
  type SampleRow,
  type TrayRow,
  type BatchRow,
  type AlertRow,
  type TrayInspectionRow,
  type PlacedShelterRow,
  type ShelterTrayLinkRow,
  type NestingBlockRow,
  type GrantRow,
  type GrantTaskRow,
  toFieldAnalysis,
  type FieldAnalysisRow,
} from './mappers'
import type { FieldChecklistRow } from './mappers'

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

/** How many rows PostgREST will return in one request unless told otherwise. */
const PAGE_SIZE = 1000

/**
 * Read an entire table, a page at a time.
 *
 * PostgREST caps a select at 1000 rows and reports NO error when it truncates
 * — the request simply succeeds with the first page. Anything that can outgrow
 * a thousand rows has to be paged, or it silently shows part of the data and
 * looks like data loss to whoever counted.
 */
async function fetchAllRows<T>(
  table: string,
  order: { column: string; ascending: boolean },
  filter?:
    | { column: string; value: unknown }
    | { column: string; in: string[] }
    | { column: string; gte: string },
): Promise<{ rows: T[]; error?: string }> {
  if (!supabase) return { rows: [], error: 'No backend connection.' }
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = supabase.from(table).select('*')
    if (filter && 'in' in filter) q = q.in(filter.column, filter.in)
    else if (filter && 'gte' in filter) q = q.gte(filter.column, filter.gte)
    else if (filter) q = q.eq(filter.column, filter.value)
    const { data, error } = await q
      .order(order.column, { ascending: order.ascending })
      .range(from, from + PAGE_SIZE - 1)
    if (error) return { rows, error: error.message }
    const page = (data as T[]) ?? []
    rows.push(...page)
    // A short page is the last page. Stop on an exact multiple too — one extra
    // empty request is cheaper than a truncated list nobody notices.
    if (page.length < PAGE_SIZE) return { rows }
  }
}

export function SupabaseProvider({ children }: { children: ReactNode }) {
  const [fields, setFields] = useState<Field[]>([])
  const [incubators, setIncubators] = useState<Incubator[]>([])
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [trayInspections, setTrayInspections] = useState<TrayInspection[]>([])
  const [readings, setReadings] = useState<SensorReading[]>([])
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [samples, setSamples] = useState<Sample[]>([])
  const [trays, setTrays] = useState<Tray[]>([])
  const [traysLoading, setTraysLoading] = useState(false)
  const [batches, setBatches] = useState<IncubationBatch[]>([])
  const [alerts, setAlerts] = useState<IncubatorAlert[]>([])
  const [costPrefsByYear, setCostPrefsByYear] = useState<Record<string, Partial<CostPrefs>>>({})
  const [placedShelters, setPlacedShelters] = useState<PlacedShelter[]>([])
  const [shelterTrayLinks, setShelterTrayLinks] = useState<ShelterTrayLink[]>([])
  const [nestingBlocks, setNestingBlocks] = useState<NestingBlock[]>([])
  const [blocks, setBlocks] = useState<Block[]>([])
  const [blockPlacements, setBlockPlacements] = useState<BlockPlacement[]>([])
  const [blocksLoading, setBlocksLoading] = useState(false)
  /** One row per season (see migration 0021) — fills the season picker without
   *  loading a single placement. */
  const [blockSeasons, setBlockSeasons] = useState<BlockSeason[]>([])
  /** Whether the pre-season inspection history has been pulled in. */
  const [earlierInspectionsLoaded, setEarlierInspectionsLoaded] = useState(false)
  const [crews, setCrews] = useState<Crew[]>([])
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const calendarPromiseRef = useRef<Promise<void> | null>(null)
  const [crewMembers, setCrewMembers] = useState<CrewMember[]>([])
  const crewsPromiseRef = useRef<Promise<void> | null>(null)
  const earlierInspPromiseRef = useRef<Promise<void> | null>(null)
  const [notificationPrefs, setNotificationPrefs] = useState<Record<string, NotificationPref>>({})
  const [grants, setGrants] = useState<Grant[]>([])
  const [grantTasks, setGrantTasks] = useState<GrantTask[]>([])
  const [fieldAnalysis, setFieldAnalysis] = useState<FieldAnalysis[]>([])
  const [fieldChecklist, setFieldChecklist] = useState<FieldChecklistCell[]>([])
  const [fieldChecklistLoading, setFieldChecklistLoading] = useState(false)
  /**
   * Starts TRUE: nothing has been fetched yet, and "no rows" and "not asked
   * yet" look identical to a screen. Only the Analysis section reads this and
   * every one of its tabs calls loadFieldAnalysis() on mount, so the first
   * paint says "Loading season data…" rather than flashing "Not enough data"
   * at someone whose data is on its way.
   */
  const [fieldAnalysisLoading, setFieldAnalysisLoading] = useState(true)
  const [fieldWeather, setFieldWeather] = useState<Record<string, FieldWeather>>({})
  /**
   * The signed-in Supabase user id, for stamping who completed what.
   * Read here rather than from useSession() so the data layer stays
   * independent of the auth provider — the seam rule cuts both ways.
   */
  const [userId, setUserId] = useState<string | null>(null)
  /**
   * A human-readable name for the signed-in user, stamped on scans so a
   * placement says who put the block out. Name if the profile has one, e-mail
   * otherwise — a bare uuid in a field crew's audit trail helps nobody.
   */
  const [userLabel, setUserLabel] = useState<string | null>(null)
  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getUser().then(async ({ data }) => {
      const u = data.user ?? null
      setUserId(u?.id ?? null)
      if (!u) return setUserLabel(null)
      const { data: prof } = await supabase!.from('profiles').select('name').eq('id', u.id).maybeSingle()
      setUserLabel((prof as { name?: string } | null)?.name?.trim() || u.email || null)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setUserId(session?.user?.id ?? null),
    )
    return () => sub.subscription.unsubscribe()
  }, [])

  // Keep a ref of readings so the realtime handler appends without re-subscribing.
  /** Oldest timestamp already fetched per incubator, so ranges load once. */
  const loadedSinceRef = useRef<Map<string, string>>(new Map())
  /** Guards the one-shot tray fetch against every screen calling it at once. */
  const traysPromiseRef = useRef<Promise<void> | null>(null)
  /**
   * One in-flight guard PER SEASON — several screens call loadBlocks() on
   * mount, and each season is fetched once.
   */
  const blocksPromiseRef = useRef<Map<number, Promise<void>>>(new Map())
  /** And for the analysis rows — every analysis tab calls loadFieldAnalysis(). */
  const analysisPromiseRef = useRef<Promise<void> | null>(null)
  /** One in-flight guard PER SEASON for the Overall Checklist, like blocks. */
  const checklistPromiseRef = useRef<Map<string, Promise<void>>>(new Map())
  /**
   * Weather cache keys already fetched or in flight. Without this, six panels
   * mounting at once each start the same 157 lookups — which is precisely what
   * the Base44 version did.
   */
  const weatherInFlightRef = useRef<Set<string>>(new Set())

  /** Read crews + live memberships for this season. */
  const refreshCrews = useCallback(async () => {
    if (!supabase) return
    const season = new Date().getFullYear()
    const [c, m] = await Promise.all([
      supabase.from('field_crews').select('*').eq('season', season).order('name'),
      supabase.from('field_crew_members').select('*').is('left_at', null),
    ])
    if (c.error || m.error) {
      // Before migration 0023 these tables do not exist. Field Mode still
      // works; it just cannot group people into crews yet.
      console.warn('[data] loadCrews:', c.error?.message ?? m.error?.message)
      crewsPromiseRef.current = null
      return
    }
    setCrews(
      ((c.data as Array<Record<string, unknown>>) ?? []).map((r) => ({
        id: String(r.id),
        name: String(r.name),
        season: Number(r.season),
        active: r.active !== false,
        currentFieldId: (r.current_field_id as string | null) ?? null,
        currentTask: (r.current_task as CrewTask | null) ?? null,
        assignedAt: (r.assigned_at as string | null) ?? null,
      })),
    )
    setCrewMembers(
      ((m.data as Array<Record<string, unknown>>) ?? []).map((r) => ({
        id: String(r.id),
        crewId: String(r.crew_id),
        userId: String(r.user_id),
        role: r.role === 'lead' ? 'lead' : 'member',
        joinedAt: String(r.joined_at),
        leftAt: (r.left_at as string | null) ?? null,
      })),
    )
  }, [])

  /** Merge a saved placement into local state, replacing any earlier version. */
  const upsertPlacement = useCallback((saved: BlockPlacement) => {
    setBlockPlacements((prev) => {
      const i = prev.findIndex((x) => x.id === saved.id)
      if (i < 0) return [saved, ...prev]
      const next = [...prev]
      next[i] = saved
      return next
    })
  }, [])
  const readingsRef = useRef<SensorReading[]>([])
  readingsRef.current = readings
  const notifRef = useRef<AppNotification[]>([])
  notifRef.current = notifications

  /**
   * Read one season's checklist marks into state.
   *
   * A named helper rather than a method on the context object, because two
   * callers need it — the lazy loader and the sheet sync, which must re-read
   * after pulling marks in. Reaching back into the memo for it would work by
   * accident and break the first time the memo is restructured.
   */
  const readChecklistYear = useCallback(
    async (year: string) => {
      if (!supabase) return
      const { data, error } = await supabase.from('field_checklist').select('*').eq('year', year)
      if (error) {
        console.error('[data] readChecklistYear:', error.message)
        throw error
      }
      const rows = ((data as FieldChecklistRow[]) ?? []).map(toFieldChecklistCell)
      setFieldChecklist((prev) => [...prev.filter((c) => c.year !== year), ...rows])
    },
    [],
  )


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

      // Inspections: THIS SEASON, paged. The old `.limit(500)` was a silent
      // truncation across every incubator at once — the same shape of bug that
      // hid a third of the blocks — and at two rounds a day on eight
      // incubators it starts dropping records within a month.
      //
      // Scoped rather than unbounded because the screens show one run or one
      // season anyway; `loadEarlierInspections()` fetches the rest on demand.
      const seasonStart = `${new Date().getFullYear()}-01-01T00:00:00.000Z`
      const [f, i, insp, notif] = await Promise.all([
        sb.from('shelter_fields').select('*').order('updated_at', { ascending: false }),
        sb.from('incubators').select('*').order('name', { ascending: true }),
        fetchAllRows<InspectionRow>('inspections', { column: 'at', ascending: false }, {
          column: 'at',
          gte: seasonStart,
        }),
        sb.from('app_notifications').select('*').is('deleted_at', null).order('created_at', { ascending: false }).limit(200),
      ])
      if (cancelled) return

      if (f.error) console.error('[data] load fields:', f.error.message)
      if (i.error) console.error('[data] load incubators:', i.error.message)
      if (insp.error) console.error('[data] load inspections:', insp.error)
      if (notif.error) console.error('[data] load notifications:', notif.error.message)

      const incs = ((i.data as IncubatorRow[]) ?? []).map(toIncubator)
      setFields(((f.data as FieldRow[]) ?? []).map(toField))
      setIncubators(incs)
      setInspections(insp.rows.map(toInspection))
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

      // Which block seasons exist. One row per season, so this is cheap even
      // when a season holds 14,000 blocks.
      const bs = await sb.from('block_seasons').select('*').order('season', { ascending: false })
      if (cancelled) return
      if (bs.error) {
        // Before migration 0021 the view doesn't exist. Not fatal: the screens
        // fall back to the seasons of whatever placements are loaded.
        console.warn('[data] load block_seasons:', bs.error.message)
      } else {
        setBlockSeasons(
          ((bs.data as Array<{ season: number; placed: number; retrieved: number; stripped: number }>) ?? [])
            .map((r) => ({
              season: Number(r.season),
              placed: Number(r.placed ?? 0),
              retrieved: Number(r.retrieved ?? 0),
              stripped: Number(r.stripped ?? 0),
            })),
        )
      }

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

      // Tray observations belonging to those inspections — same window, same
      // paging. A capped fetch here silently drops the tray rows off the
      // OLDEST inspections still on screen, which reads as "nobody looked at
      // any trays that day" rather than as missing data.
      const ti = await fetchAllRows<TrayInspectionRow>(
        'tray_inspections',
        { column: 'timestamp', ascending: false },
        { column: 'timestamp', gte: seasonStart },
      )
      if (cancelled) return
      if (ti.error) console.warn('[data] load tray_inspections:', ti.error)
      else setTrayInspections(ti.rows.map(toTrayInspection))

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
            .limit(20),
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

  // Sales lives in its own hook — this file is long enough already, and the
  // slice shares no state with anything above it. Nothing is fetched until a
  // Sales screen calls loadSales().
  const sales = useSalesSupabase()
  const tasks = useTasksSupabase(userId)
  const settings2 = useSettings(userId, true)

  const value = useMemo<DataContextValue>(
    () => ({
      ...sales,
      ...tasks,
      ...settings2,
      fields,
      incubators,
      inspections,
      readings,
      samples,
      trays,
      traysLoading,
      loadTrays: () => {
        if (traysPromiseRef.current) return traysPromiseRef.current
        if (!supabase) return Promise.resolve()
        setTraysLoading(true)
        const run = (async () => {
          // ~4.6k rows past PostgREST's 1000-row cap, so page through them.
          const PAGE = 1000
          const all: Tray[] = []
          for (let from = 0; ; from += PAGE) {
            const page = await supabase!
              .from('trays')
              .select('*')
              .order('tray_number', { ascending: true })
              .range(from, from + PAGE - 1)
            if (page.error) {
              console.error('[data] loadTrays:', page.error.message)
              traysPromiseRef.current = null // let it retry
              break
            }
            const rows = (page.data as TrayRow[]) ?? []
            all.push(...rows.map(toTray))
            if (rows.length < PAGE) break
          }
          setTrays(all)
          setTraysLoading(false)
        })()
        traysPromiseRef.current = run
        return run
      },
      batches,
      alerts,
      trayInspections,
      addInspection: (input: Omit<Inspection, 'id'>, trayObservations?: TrayObservation[]) => {
        if (!supabase) return
        void (async () => {
          const { data, error } = await supabase!
            .from('inspections')
            .insert(inspectionInsert(input))
            .select()
            .single()
          if (error) {
            console.error('[data] addInspection:', error.message)
            return
          }
          const saved = toInspection(data as InspectionRow)
          setInspections((prev) => [saved, ...prev])
          if (!trayObservations?.length) return

          // Written after the parent exists, so inspection_id is always valid.
          const rows = trayObservations.map((o) => ({
            inspection_id: saved.id,
            tray_id: o.trayId,
            tray_number: o.trayNumber,
            incubator_id: input.incubatorId,
            timestamp: input.at,
            stack_position: o.stackPosition,
            depth_position: o.depthPosition,
            cells_opened: o.cellsOpened,
            dev_stage: o.devStage,
            notes: o.notes ?? '',
          }))
          const res = await supabase!.from('tray_inspections').insert(rows).select()
          if (res.error) {
            console.error('[data] addInspection tray observations:', res.error.message)
            return
          }
          setTrayInspections((prev) => [
            ...((res.data as TrayInspectionRow[]) ?? []).map(toTrayInspection),
            ...prev,
          ])
        })()
      },
      loadEarlierInspections: () => {
        if (earlierInspPromiseRef.current) return earlierInspPromiseRef.current
        if (!supabase) return Promise.resolve()
        const run = (async () => {
          // Everything, not just the older slice: one paged read is simpler
          // than two windows to keep straight, and the merge below makes the
          // overlap harmless.
          const [older, olderTrays] = await Promise.all([
            fetchAllRows<InspectionRow>('inspections', { column: 'at', ascending: false }),
            fetchAllRows<TrayInspectionRow>('tray_inspections', {
              column: 'timestamp',
              ascending: false,
            }),
          ])
          if (older.error || olderTrays.error) {
            console.error('[data] loadEarlierInspections:', older.error ?? olderTrays.error)
            earlierInspPromiseRef.current = null // let it retry
            return
          }
          // Merge rather than replace: this season is already loaded and is
          // the half people are actually looking at.
          setInspections((prev) => {
            const byId = new Map(prev.map((x) => [x.id, x]))
            for (const r of older.rows.map(toInspection)) byId.set(r.id, r)
            return [...byId.values()].sort((a, b) => b.at.localeCompare(a.at))
          })
          setTrayInspections((prev) => {
            const byId = new Map(prev.map((x) => [x.id, x]))
            for (const r of olderTrays.rows.map(toTrayInspection)) byId.set(r.id, r)
            return [...byId.values()]
          })
          setEarlierInspectionsLoaded(true)
        })()
        earlierInspPromiseRef.current = run
        return run
      },
      earlierInspectionsLoaded,

      crews,
      crewMembers,
      loadCrews: () => {
        if (crewsPromiseRef.current) return crewsPromiseRef.current
        const run = refreshCrews()
        crewsPromiseRef.current = run
        return run
      },
      joinCrew: async (crewId: string, asLead: boolean) => {
        if (!supabase || !userId) return { ok: false, error: 'Sign in first.' }
        const plan = planJoin(crewMembers, userId, crewId)
        const now = new Date().toISOString()
        // Leave first: one active membership per person is a database
        // constraint, so joining before leaving would be rejected.
        for (const id of plan.leave) {
          const { error } = await supabase.from('field_crew_members').update({ left_at: now }).eq('id', id)
          if (error) return { ok: false, error: error.message }
        }
        // Hand the lead over BEFORE claiming it: one lead per crew is a
        // database constraint, so promoting first is simply rejected.
        if (asLead) {
          for (const id of planTakeLead(crewMembers, userId, crewId).demote) {
            const { error } = await supabase.from('field_crew_members').update({ role: 'member' }).eq('id', id)
            if (error) return { ok: false, error: error.message }
          }
        }
        if (plan.join) {
          const { error } = await supabase
            .from('field_crew_members')
            .insert({ crew_id: crewId, user_id: userId, role: asLead ? 'lead' : 'member' })
          if (error) return { ok: false, error: error.message }
        } else if (asLead) {
          const promote = planTakeLead(crewMembers, userId, crewId).promote
          if (promote) {
            const { error } = await supabase.from('field_crew_members').update({ role: 'lead' }).eq('id', promote)
            if (error) return { ok: false, error: error.message }
          }
        }
        crewsPromiseRef.current = null
        await refreshCrews()
        return { ok: true }
      },
      leaveCrew: async () => {
        if (!supabase || !userId) return { ok: false, error: 'Sign in first.' }
        const mine = crewMembers.find((x) => x.userId === userId && x.leftAt == null)
        if (!mine) return { ok: true }
        const { error } = await supabase
          .from('field_crew_members')
          .update({ left_at: new Date().toISOString() })
          .eq('id', mine.id)
        if (error) return { ok: false, error: error.message }
        crewsPromiseRef.current = null
        await refreshCrews()
        return { ok: true }
      },
      updateCrew: async (id: string, patch: { name?: string; active?: boolean }) => {
        if (!supabase) return { ok: false, error: 'No backend connection.' }
        const row: Record<string, unknown> = {}
        if (patch.name !== undefined) {
          const clean = patch.name.trim()
          if (!clean) return { ok: false, error: 'A crew needs a name.' }
          row.name = clean
        }
        if (patch.active !== undefined) row.active = patch.active
        if (Object.keys(row).length === 0) return { ok: true }
        const { error } = await supabase.from('field_crews').update(row).eq('id', id)
        if (error) return { ok: false, error: error.message }
        crewsPromiseRef.current = null
        await refreshCrews()
        return { ok: true }
      },
      setCrewLead: async (crewId: string, targetUserId: string) => {
        if (!supabase) return { ok: false, error: 'No backend connection.' }
        const plan = planTakeLead(crewMembers, targetUserId, crewId)
        // Demote first: one lead per crew is a unique index, so promoting
        // before demoting is rejected outright.
        for (const id of plan.demote) {
          const { error } = await supabase.from('field_crew_members').update({ role: 'member' }).eq('id', id)
          if (error) return { ok: false, error: error.message }
        }
        if (plan.promote) {
          const { error } = await supabase
            .from('field_crew_members')
            .update({ role: 'lead' })
            .eq('id', plan.promote)
          if (error) return { ok: false, error: error.message }
        }
        crewsPromiseRef.current = null
        await refreshCrews()
        return { ok: true }
      },
      addCrewMember: async (crewId: string, targetUserId: string, asLead = false) => {
        if (!supabase) return { ok: false, error: 'No backend connection.' }
        const plan = planJoin(crewMembers, targetUserId, crewId)
        const now = new Date().toISOString()
        for (const id of plan.leave) {
          const { error } = await supabase.from('field_crew_members').update({ left_at: now }).eq('id', id)
          if (error) return { ok: false, error: error.message }
        }
        if (plan.join) {
          const { error } = await supabase
            .from('field_crew_members')
            .insert({ crew_id: crewId, user_id: targetUserId, role: 'member' })
          if (error) return { ok: false, error: error.message }
        }
        crewsPromiseRef.current = null
        await refreshCrews()
        if (!asLead) return { ok: true }
        // Re-read before promoting: the row we just inserted is not in the
        // state this closure captured.
        const fresh = await supabase
          .from('field_crew_members')
          .select('*')
          .is('left_at', null)
          .eq('crew_id', crewId)
        const rows = ((fresh.data as Array<Record<string, unknown>>) ?? []).map((r) => ({
          id: String(r.id),
          crewId: String(r.crew_id),
          userId: String(r.user_id),
          role: r.role === 'lead' ? ('lead' as const) : ('member' as const),
          joinedAt: String(r.joined_at),
          leftAt: (r.left_at as string | null) ?? null,
        }))
        const promote = planTakeLead(rows, targetUserId, crewId)
        for (const id of promote.demote) {
          await supabase.from('field_crew_members').update({ role: 'member' }).eq('id', id)
        }
        if (promote.promote) {
          await supabase.from('field_crew_members').update({ role: 'lead' }).eq('id', promote.promote)
        }
        crewsPromiseRef.current = null
        await refreshCrews()
        return { ok: true }
      },
      removeCrewMember: async (membershipId: string) => {
        if (!supabase) return { ok: false, error: 'No backend connection.' }
        const { error } = await supabase
          .from('field_crew_members')
          .update({ left_at: new Date().toISOString() })
          .eq('id', membershipId)
        if (error) return { ok: false, error: error.message }
        crewsPromiseRef.current = null
        await refreshCrews()
        return { ok: true }
      },
      assignCrew: async (
        id: string,
        assignment: { fieldId: string | null; task: CrewTask | null },
      ) => {
        if (!supabase) return { ok: false, error: 'No backend connection.' }
        const { error } = await supabase
          .from('field_crews')
          .update({
            current_field_id: assignment.fieldId,
            current_task: assignment.task,
            // Stamped so "no job set" and "set three days ago and forgotten"
            // can be told apart.
            assigned_at: assignment.task ? new Date().toISOString() : null,
          })
          .eq('id', id)
        if (error) return { ok: false, error: error.message }
        crewsPromiseRef.current = null
        await refreshCrews()
        return { ok: true }
      },
      createCrew: async (name: string) => {
        if (!supabase) return { ok: false, error: 'No backend connection.' }
        const clean = name.trim()
        if (!clean) return { ok: false, error: 'Give the crew a name.' }
        const { data, error } = await supabase
          .from('field_crews')
          .insert({ name: clean, season: new Date().getFullYear(), created_by: userId })
          .select()
          .single()
        if (error) return { ok: false, error: error.message }
        crewsPromiseRef.current = null
        await refreshCrews()
        return { ok: true, crewId: String((data as { id: string }).id) }
      },

      calendarEvents,
      loadCalendarEvents: () => {
        if (calendarPromiseRef.current) return calendarPromiseRef.current
        if (!supabase) return Promise.resolve()
        const run = (async () => {
          const { data, error } = await supabase!
            .from('calendar_events')
            .select('*')
            .order('start_date', { ascending: true })
          if (error) {
            // Before migration 0029 the table does not exist. The calendar
            // still shows incubation milestones; it just cannot hold anything
            // anyone typed.
            console.warn('[data] loadCalendarEvents:', error.message)
            calendarPromiseRef.current = null
            return
          }
          setCalendarEvents(
            ((data as Array<Record<string, unknown>>) ?? []).map((r) => ({
              id: String(r.id),
              title: String(r.title ?? ''),
              startDate: String(r.start_date),
              endDate: (r.end_date as string | null) ?? null,
              startTime: (r.start_time as string | null) ?? null,
              notes: String(r.notes ?? ''),
              category: String(r.category ?? ''),
              fieldId: (r.field_id as string | null) ?? null,
              incubatorId: (r.incubator_id as string | null) ?? null,
              crewId: (r.crew_id as string | null) ?? null,
              task: (r.task as CrewTask | null) ?? null,
            })),
          )
        })()
        calendarPromiseRef.current = run
        return run
      },
      saveCalendarEvent: async (input) => {
        if (!supabase) return { ok: false, error: 'No backend connection.' }
        const row: Record<string, unknown> = {
          title: input.title.trim(),
          start_date: input.startDate,
          end_date: input.endDate ?? null,
          start_time: input.startTime || null,
          notes: input.notes ?? '',
          category: input.category ?? '',
          field_id: input.fieldId ?? null,
          incubator_id: input.incubatorId ?? null,
          crew_id: input.crewId ?? null,
          task: input.task ?? null,
        }
        if (!row.title) return { ok: false, error: 'Give the event a name.' }

        const res = input.id
          ? await supabase
              .from('calendar_events')
              .update({ ...row, updated_at: new Date().toISOString() })
              .eq('id', input.id)
              .select()
              .single()
          : await supabase
              .from('calendar_events')
              .insert({ ...row, created_by: userId })
              .select()
              .single()
        if (res.error) {
          console.error('[data] saveCalendarEvent:', res.error.message)
          return { ok: false, error: res.error.message }
        }
        const r = res.data as Record<string, unknown>
        const saved: CalendarEvent = {
          id: String(r.id),
          title: String(r.title ?? ''),
          startDate: String(r.start_date),
          endDate: (r.end_date as string | null) ?? null,
          startTime: (r.start_time as string | null) ?? null,
          notes: String(r.notes ?? ''),
          category: String(r.category ?? ''),
          fieldId: (r.field_id as string | null) ?? null,
          incubatorId: (r.incubator_id as string | null) ?? null,
          crewId: (r.crew_id as string | null) ?? null,
          task: (r.task as CrewTask | null) ?? null,
        }
        setCalendarEvents((prev) => {
          const i = prev.findIndex((x) => x.id === saved.id)
          if (i < 0) return [...prev, saved].sort((a, b) => a.startDate.localeCompare(b.startDate))
          const next = [...prev]
          next[i] = saved
          return next
        })
        return { ok: true, id: saved.id }
      },
      deleteCalendarEvent: async (id: string) => {
        if (!supabase) return { ok: false, error: 'No backend connection.' }
        const { error } = await supabase.from('calendar_events').delete().eq('id', id)
        if (error) return { ok: false, error: error.message }
        setCalendarEvents((prev) => prev.filter((e) => e.id !== id))
        return { ok: true }
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
      fetchReadings: async (incubatorId: string, fromIso: string, toIso: string) => {
        if (!supabase) return []
        // Bounded at BOTH ends and returned, not merged: a three-year report
        // must not leave three years of readings sitting in memory afterwards.
        const PAGE = 1000
        const out: SensorReading[] = []
        for (let from = 0; ; from += PAGE) {
          const res = await supabase
            .from('sensor_readings')
            .select('*')
            .eq('incubator_id', incubatorId)
            .gte('at', fromIso)
            .lte('at', toIso)
            .order('at', { ascending: true })
            .range(from, from + PAGE - 1)
          if (res.error) throw new Error(res.error.message)
          const rows = (res.data as SensorReadingRow[]) ?? []
          out.push(...rows.map(toSensorReading))
          if (rows.length < PAGE) break
        }
        return out
      },
      fetchModeEvents: async (incubatorId: string, fromIso: string, toIso: string) => {
        if (!supabase) return []
        const res = await supabase
          .from('incubator_mode_events')
          .select('*')
          .eq('incubator_id', incubatorId)
          .gte('changed_at', fromIso)
          .lte('changed_at', toIso)
          .order('changed_at', { ascending: true })
        if (res.error) {
          // A missing table means migration 0025 has not been applied yet. The
          // report still works — it falls back to reading the setting timeline
          // out of the measured temperature — so this must not throw.
          console.warn('[data] fetchModeEvents:', res.error.message)
          return []
        }
        return ((res.data as IncubatorModeEventRow[]) ?? []).map(toIncubatorModeEvent)
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
      saveSample: async (id: string, patch: Partial<Sample>) => {
        if (!supabase) return { ok: false, error: 'No backend connection.' }
        const row = samplePatch(patch)
        if (Object.keys(row).length === 0) return { ok: true }
        const { data, error } = await supabase.from('samples').update(row).eq('id', id).select().single()
        if (error) {
          console.error('[data] saveSample:', error.message)
          return { ok: false, error: error.message }
        }
        const saved = toSample(data as SampleRow)
        setSamples((prev) => prev.map((x) => (x.id === id ? saved : x)))
        return { ok: true }
      },
      createLotFromReturns: async ({
        fieldId,
        harvestSeason,
        name,
        totalWeightLbs,
        notes,
      }: {
        fieldId: string
        harvestSeason: number
        name: string
        totalWeightLbs: number
        notes?: string
      }) => {
        if (!supabase) return { ok: false, error: 'No backend connection.' }
        // Match on the ORIGIN, not the name: renaming a lot must not make the
        // next run create a duplicate for the same field and harvest year.
        const existing = samples.find(
          (x) => x.fieldId === fieldId && x.harvestSeason === harvestSeason,
        )
        const { data, error } = existing
          ? await supabase
              .from('samples')
              // Weight and notes ONLY. An existing lot may have been x-rayed
              // and split into trays since; rewriting its name or grading
              // because someone re-ran this would destroy real work.
              .update({ total_weight_lbs: totalWeightLbs, notes: notes ?? '' })
              .eq('id', existing.id)
              .select()
              .single()
          : await supabase
              .from('samples')
              .insert({
                name,
                field_id: fieldId,
                harvest_season: harvestSeason,
                total_weight_lbs: totalWeightLbs,
                notes: notes ?? '',
              })
              .select()
              .single()
        if (error) {
          console.error('[data] createLotFromReturns:', error.message)
          return { ok: false, error: error.message }
        }
        const saved = toSample(data as SampleRow)
        setSamples((prev) => {
          const i = prev.findIndex((x) => x.id === saved.id)
          if (i < 0) return [...prev, saved].sort((a, z) => a.name.localeCompare(z.name))
          const next = [...prev]
          next[i] = saved
          return next
        })
        return { ok: true, sampleId: saved.id, created: !existing }
      },

      importSamples: async (rows: Array<Partial<Sample> & { name: string }>) => {
        if (!supabase) return { updated: 0, created: 0, error: 'No backend connection.' }
        // Match by name like the desktop importer, so an update keeps the
        // sample's id and therefore every tray already linked to it.
        const byName = new Map(samples.map((s) => [s.name.trim().toLowerCase(), s]))
        let updated = 0
        let created = 0
        const importedAt = new Date().toISOString()

        for (const r of rows) {
          const existing = byName.get(r.name.trim().toLowerCase())
          const row = samplePatch({ ...r, importDate: importedAt })
          if (existing) {
            const { data, error } = await supabase
              .from('samples').update(row).eq('id', existing.id).select().single()
            if (error) {
              console.error('[data] importSamples update:', error.message)
              return { updated, created, error: error.message }
            }
            const saved = toSample(data as SampleRow)
            setSamples((prev) => prev.map((x) => (x.id === saved.id ? saved : x)))
            updated++
          } else {
            const { data, error } = await supabase.from('samples').insert(row).select().single()
            if (error) {
              console.error('[data] importSamples insert:', error.message)
              return { updated, created, error: error.message }
            }
            const saved = toSample(data as SampleRow)
            setSamples((prev) => [...prev, saved])
            created++
          }
        }
        return { updated, created }
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
        const row: Record<string, unknown> = {
          tray_number: trayNumber,
          sample_id: sampleId,
          incubator_id: incubatorId,
          status: 'active',
        }
        // Weight is NOT written here: it's looked up from the sample so an
        // x-ray correction flows through (see trayWeightKg). `weight_lbs` stays
        // free for an actual measurement. The date is stamped on first use only,
        // so re-scanning to move a tray doesn't rewrite when it went in.
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

      // ── Nesting blocks ────────────────────────────────────────────────────
      blocks,
      blockPlacements,
      blocksLoading,
      loadBlocks: (season?: number) => {
        const yr = season ?? new Date().getFullYear()
        // Already have it? Nothing to do. Screens call this on every mount.
        const inFlight = blocksPromiseRef.current.get(yr)
        if (inFlight) return inFlight
        if (!supabase) return Promise.resolve()
        setBlocksLoading(true)
        const run = (async () => {
          // ONE SEASON AT A TIME. A big season runs to ~14,000 blocks, so
          // "fetch everything and filter in the browser" would mean tens of
          // thousands of rows on a phone in a field to look at one year.
          const p = await fetchAllRows<BlockPlacementRow>(
            'block_placements',
            { column: 'season', ascending: false },
            { column: 'season', value: yr },
          )
          if (p.error) {
            console.error('[data] loadBlocks/placements:', p.error)
            blocksPromiseRef.current.delete(yr) // let it retry
            setBlocksLoading(false)
            return
          }
          const placements = p.rows.map(toBlockPlacement)

          // Only the blocks these placements point at. The registry spans
          // every season a label has ever been used, and this screen needs the
          // labels for THIS one. Requested in chunks because a few thousand ids
          // in a URL is a request no server will accept.
          const wanted = [...new Set(placements.map((x) => x.blockId))].filter(Boolean)
          const CHUNK = 200
          const blockRows: BlockRow[] = []
          for (let i = 0; i < wanted.length; i += CHUNK) {
            const got = await fetchAllRows<BlockRow>(
              'blocks',
              { column: 'label', ascending: true },
              { column: 'id', in: wanted.slice(i, i + CHUNK) },
            )
            if (got.error) {
              console.error('[data] loadBlocks/blocks:', got.error)
              blocksPromiseRef.current.delete(yr)
              setBlocksLoading(false)
              return
            }
            blockRows.push(...got.rows)
          }

          // MERGE, never replace: another season may already be loaded, and
          // dropping it would make switching seasons wipe the previous one.
          setBlockPlacements((prev) => {
            const byId = new Map(prev.map((x) => [x.id, x]))
            for (const x of placements) byId.set(x.id, x)
            return [...byId.values()]
          })
          setBlocks((prev) => {
            const byId = new Map(prev.map((b) => [b.id, b]))
            for (const b of blockRows.map(toBlock)) byId.set(b.id, b)
            return [...byId.values()].sort((a, z) => a.label.localeCompare(z.label))
          })
          setBlocksLoading(false)
        })()
        blocksPromiseRef.current.set(yr, run)
        return run
      },

      blockSeasons,

      loadBlockHistory: async (blockId: string) => {
        if (!supabase || !blockId) return
        const { data, error } = await supabase
          .from('block_placements')
          .select('*')
          .eq('block_id', blockId)
          .order('season', { ascending: false })
        if (error) return console.error('[data] loadBlockHistory:', error.message)
        const rows = ((data as BlockPlacementRow[]) ?? []).map(toBlockPlacement)
        setBlockPlacements((prev) => {
          const byId = new Map(prev.map((x) => [x.id, x]))
          for (const x of rows) byId.set(x.id, x)
          return [...byId.values()]
        })
      },

      // ── Season analysis ───────────────────────────────────────────────────
      // ── Overall Checklist ───────────────────────────────────────────────
      fieldChecklist,
      fieldChecklistLoading,
      loadFieldChecklist: (year) => {
        const inFlight = checklistPromiseRef.current.get(year)
        if (inFlight) return inFlight
        if (!supabase) return Promise.resolve()
        setFieldChecklistLoading(true)
        const run = (async () => {
          try {
            // Replaces this season's marks, keeping any other season held.
            await readChecklistYear(year)
          } catch {
            checklistPromiseRef.current.delete(year) // let it retry
          }
          setFieldChecklistLoading(false)
        })()
        checklistPromiseRef.current.set(year, run)
        return run
      },
      syncChecklistSheet: async (year) => {
        const { data } = await supabase!.auth.getSession()
        const token = data.session?.access_token
        if (!token) return { ok: false, error: 'Your session expired — sign in again.' }
        try {
          const res = await fetch('/.netlify/functions/checklist-sync-now', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ year }),
          })
          const out = await res.json().catch(() => ({}))
          if (!res.ok) return { ok: false, error: out.error ?? `Sync failed (${res.status})` }
          // The sync may have pulled marks in; re-read so the grid shows them
          // without a refresh.
          checklistPromiseRef.current.delete(year)
          await readChecklistYear(year)
          return { ok: true, toApp: out.toApp, toSheet: out.toSheet }
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : 'Sync failed' }
        }
      },
      saveChecklistCell: async (input) => {
        if (!supabase) return { ok: false, error: 'No backend connection.' }
        // Upsert on the natural key so ticking a cell twice updates the mark
        // rather than adding a second one. Only the keys passed are sent —
        // PostgREST would otherwise write nulls over the halves not being set.
        const row: Record<string, unknown> = {
          year: input.year,
          field_name: input.fieldName,
          step: input.step,
        }
        if (input.shelterFieldId !== undefined) row.shelter_field_id = input.shelterFieldId
        if (input.plannedDate !== undefined) row.planned_date = input.plannedDate
        if (input.completedDate !== undefined) row.completed_date = input.completedDate
        if (input.note !== undefined) row.note = input.note

        const { data, error } = await supabase
          .from('field_checklist')
          .upsert(row, { onConflict: 'year,field_name,step' })
          .select()
          .single()
        if (error) {
          console.error('[data] saveChecklistCell:', error.message)
          return { ok: false, error: error.message }
        }
        const saved = toFieldChecklistCell(data as FieldChecklistRow)
        setFieldChecklist((prev) => {
          const i = prev.findIndex((c) => c.id === saved.id)
          return i >= 0 ? prev.map((c, j) => (j === i ? saved : c)) : [...prev, saved]
        })
        return { ok: true }
      },

      fieldAnalysis,
      fieldAnalysisLoading,
      loadFieldAnalysis: () => {
        if (analysisPromiseRef.current) return analysisPromiseRef.current
        // No backend to ask: resolve the initial `true` above, or the section
        // would sit on "Loading…" for ever.
        if (!supabase) {
          setFieldAnalysisLoading(false)
          return Promise.resolve()
        }
        setFieldAnalysisLoading(true)
        const run = (async () => {
          // ~157 rows today and growing by a season a year, so a single select
          // stays well under PostgREST's 1000-row cap. Ordered newest-first so
          // the field list opens on the current season.
          const { data, error } = await supabase!
            .from('field_analysis')
            .select('*')
            .order('year', { ascending: false })
            .order('field_name', { ascending: true })
          if (error) {
            console.error('[data] loadFieldAnalysis:', error.message)
            analysisPromiseRef.current = null // let it retry
          } else {
            setFieldAnalysis(((data as FieldAnalysisRow[]) ?? []).map(toFieldAnalysis))
          }
          setFieldAnalysisLoading(false)
        })()
        analysisPromiseRef.current = run
        return run
      },

      fieldWeather,
      loadFieldWeather: async (rows) => {
        if (!supabase) return
        // Collapse to distinct grid cells first: neighbouring fields share a
        // cell, and the same field appears once per season.
        const wanted = new Map<string, { lat: number; lng: number; year: string }>()
        for (const r of rows) {
          if (r.lat === null || r.lng === null || !r.year) continue
          const key = weatherKey(r.lat, r.lng, r.year)
          if (weatherInFlightRef.current.has(key)) continue
          wanted.set(key, { lat: r.lat, lng: r.lng, year: r.year })
        }
        if (wanted.size === 0) return
        for (const key of wanted.keys()) weatherInFlightRef.current.add(key)

        try {
          // Serve whatever the cache already holds before going out.
          const { data: cached } = await supabase
            .from('weather_cache')
            .select('lat_key,lng_key,year,daily')
            .in('year', [...new Set([...wanted.values()].map((v) => v.year))])

          const found: Record<string, FieldWeather> = {}
          for (const row of (cached ?? []) as WeatherCacheRow[]) {
            const key = `${Number(row.lat_key).toFixed(3)},${Number(row.lng_key).toFixed(3)},${row.year}`
            if (!wanted.has(key)) continue
            found[key] = summariseWeather(row.daily as OpenMeteoDaily, key, row.year)
            wanted.delete(key)
          }
          if (Object.keys(found).length) setFieldWeather((prev) => ({ ...prev, ...found }))

          // Anything still wanted has never been fetched. The Netlify function
          // does the outbound call and writes the cache, so the browser never
          // talks to Open-Meteo directly and one warm-up serves every user.
          if (wanted.size === 0) return
          const res = await fetch('/.netlify/functions/weather-fetch', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ cells: [...wanted.entries()].map(([key, v]) => ({ key, ...v })) }),
          })
          if (!res.ok) {
            console.error('[data] loadFieldWeather:', res.status, await res.text())
            // Allow a retry — a cold cache behind a transient failure should
            // not stay empty for the rest of the session.
            for (const key of wanted.keys()) weatherInFlightRef.current.delete(key)
            return
          }
          const payload = (await res.json()) as { cells: Array<{ key: string; year: string; daily: OpenMeteoDaily }> }
          const fetched: Record<string, FieldWeather> = {}
          for (const c of payload.cells ?? []) {
            fetched[c.key] = summariseWeather(c.daily, c.key, c.year)
          }
          if (Object.keys(fetched).length) setFieldWeather((prev) => ({ ...prev, ...fetched }))
        } catch (e) {
          console.error('[data] loadFieldWeather:', e)
          for (const key of wanted.keys()) weatherInFlightRef.current.delete(key)
        }
      },

      saveFieldAnalysis: async (id, patch) => {
        if (!supabase) return { ok: false, error: 'No backend connection.' }
        const { data, error } = await supabase
          .from('field_analysis')
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select()
          .single()
        if (error) {
          console.error('[data] saveFieldAnalysis:', error.message)
          return { ok: false, error: error.message }
        }
        const saved = toFieldAnalysis(data as FieldAnalysisRow)
        setFieldAnalysis((prev) => prev.map((r) => (r.id === saved.id ? saved : r)))
        return { ok: true }
      },

      importFieldAnalysis: async (rows) => {
        if (!supabase) return { inserted: 0, updated: 0, skipped: 0, error: 'No backend connection.' }
        const parsed: Array<Partial<FieldAnalysis> & { field_name: string; year: string }> = []
        let skipped = 0
        for (const raw of rows) {
          const row = parseAnalysisCsvRow(raw)
          if (row) parsed.push(row)
          else skipped++
        }
        if (parsed.length === 0) {
          return { inserted: 0, updated: 0, skipped, error: 'No rows had both a field name and a year.' }
        }

        // Which keys already exist, so the caller can report inserted vs
        // updated honestly rather than calling every upsert a "create".
        const existing = new Set(fieldAnalysis.map((r) => `${r.field_name}|${r.year}`))
        const updated = parsed.filter((r) => existing.has(`${r.field_name}|${r.year}`)).length

        const { error } = await supabase
          .from('field_analysis')
          .upsert(parsed, { onConflict: 'field_name,year' })
        if (error) {
          console.error('[data] importFieldAnalysis:', error.message)
          return { inserted: 0, updated: 0, skipped, error: error.message }
        }

        // Re-read rather than patching local state: the upsert may have filled
        // defaults and the ids of new rows are server-assigned.
        analysisPromiseRef.current = null
        const { data } = await supabase
          .from('field_analysis')
          .select('*')
          .order('year', { ascending: false })
          .order('field_name', { ascending: true })
        setFieldAnalysis(((data as FieldAnalysisRow[]) ?? []).map(toFieldAnalysis))

        return { inserted: parsed.length - updated, updated, skipped }
      },

      placeBlock: async ({ label, fieldId, lat, lng, season }) => {
        if (!supabase) return { ok: false, created: false, error: 'No backend connection.' }
        const clean = label.trim()
        if (!clean) return { ok: false, created: false, error: 'That code was empty.' }
        const yr = season ?? new Date().getFullYear()

        // Register an unknown label rather than refusing it — blocks reach the
        // field before anyone enters them, and a refusal would stop the work.
        let block = blocks.find((x) => x.label.trim().toLowerCase() === clean.toLowerCase())
        const isNewBlock = !block
        if (!block) {
          const { data, error } = await supabase
            .from('blocks')
            .upsert({ label: clean }, { onConflict: 'label' })
            .select()
            .single()
          if (error) {
            console.error('[data] placeBlock/register:', error.message)
            return { ok: false, created: false, error: error.message }
          }
          block = toBlock(data as BlockRow)
          setBlocks((prev) => [...prev, block!].sort((a, z) => a.label.localeCompare(z.label)))
        }

        const existing = blockPlacements.find((x) => x.blockId === block!.id && x.season === yr)

        // Re-scanning a block already placed this season CORRECTS its spot.
        // Done as an explicit UPDATE of just the position and field, rather
        // than an upsert of the whole row: a block re-scanned AFTER it was
        // weighed must not risk its weights, and an update that names its
        // columns cannot touch them whatever the API does with the rest.
        // Last season's row is a different key and is never involved.
        const { data, error } = existing
          ? await supabase
              .from('block_placements')
              .update({ field_id: fieldId, lat, lon: lng, placed_by: userLabel })
              .eq('id', existing.id)
              .select()
              .single()
          : // New placement. Upsert rather than insert so two people scanning
            // the same block at once can't collide on the unique key.
            await supabase
              .from('block_placements')
              .upsert(
                {
                  block_id: block.id,
                  season: yr,
                  field_id: fieldId,
                  lat,
                  lon: lng,
                  placed_at: new Date().toISOString(),
                  placed_by: userLabel,
                },
                { onConflict: 'block_id,season' },
              )
              .select()
              .single()
        if (error) {
          console.error('[data] placeBlock:', error.message)
          return { ok: false, created: false, error: error.message }
        }
        const saved = toBlockPlacement(data as BlockPlacementRow)
        upsertPlacement(saved)
        return {
          ok: true,
          created: isNewBlock || !existing,
          placementId: saved.id,
          movedFromFieldId:
            existing && existing.fieldId && existing.fieldId !== fieldId ? existing.fieldId : null,
        }
      },

      undoPlacement: async (placementId: string) => {
        if (!supabase) return { ok: false, error: 'No backend connection.' }
        const placement = blockPlacements.find((x) => x.id === placementId)
        if (!placement) return { ok: false, error: 'That scan is no longer in the system.' }
        // Undo removes a SCAN, not a season of work. A placement carrying
        // weights has been through a weigh-in since, and deleting it would
        // throw away the numbers the whole returns map is built on.
        if (placement.grossWeightLbs != null || placement.strippedWeightLbs != null) {
          return { ok: false, error: 'This block has been weighed since — undo would delete the weights.' }
        }

        const { error } = await supabase.from('block_placements').delete().eq('id', placementId)
        if (error) {
          console.error('[data] undoPlacement:', error.message)
          return { ok: false, error: error.message }
        }
        setBlockPlacements((prev) => prev.filter((x) => x.id !== placementId))

        // A label first seen by this scan leaves a block registered to nothing
        // once its placement is gone. Clear it too, so undoing really does undo
        // — but only when no other season is using it.
        const others = blockPlacements.filter(
          (x) => x.blockId === placement.blockId && x.id !== placementId,
        )
        let blockRemoved = false
        if (others.length === 0) {
          const { error: bErr } = await supabase.from('blocks').delete().eq('id', placement.blockId)
          if (bErr) {
            // The placement is already gone; a stranded label is untidy, not
            // wrong, so this reports rather than pretending the undo failed.
            console.warn('[data] undoPlacement/block:', bErr.message)
          } else {
            blockRemoved = true
            setBlocks((prev) => prev.filter((b) => b.id !== placement.blockId))
          }
        }
        return { ok: true, blockRemoved }
      },

      weighBlock: async ({ label, stage, weightLbs, season, fieldId, lat, lng }) => {
        if (!supabase) return { ok: false, error: 'No backend connection.' }
        if (!Number.isFinite(weightLbs) || weightLbs < 0) return { ok: false, error: 'Enter a valid weight.' }
        const clean = label.trim()
        const yr = season ?? new Date().getFullYear()

        // Register an unknown label rather than refusing the weight. The scan
        // is evidence the block exists and is in someone's hands; turning the
        // crew away loses far more than it protects.
        let block = blocks.find((x) => x.label.trim().toLowerCase() === clean.toLowerCase())
        let backfilled = false
        if (!block) {
          const reg = await supabase
            .from('blocks')
            .upsert({ label: clean }, { onConflict: 'label' })
            .select()
            .single()
          if (reg.error) return { ok: false, error: reg.error.message }
          block = toBlock(reg.data as BlockRow)
          backfilled = true
          setBlocks((prev) => [...prev, block!].sort((a, z) => a.label.localeCompare(z.label)))
        }

        // Same for a missing placement: create one so the weight has somewhere
        // to live. The field comes from wherever the crew is standing, and may
        // be null — a weight attributed to no field still counts the block and
        // still shows on the list, it just can't join a field's returns.
        let placement = blockPlacements.find((x) => x.blockId === block!.id && x.season === yr)
        if (!placement) {
          const made = await supabase
            .from('block_placements')
            .upsert(
              {
                block_id: block.id,
                season: yr,
                field_id: fieldId ?? null,
                lat: lat ?? null,
                lon: lng ?? null,
                placed_at: null,
                placed_by: userLabel,
                notes: 'Placement created at weigh-in — the placement scan was missed.',
              },
              { onConflict: 'block_id,season' },
            )
            .select()
            .single()
          if (made.error) {
            console.error('[data] weighBlock/backfill:', made.error.message)
            return { ok: false, error: made.error.message }
          }
          placement = toBlockPlacement(made.data as BlockPlacementRow)
          upsertPlacement(placement)
          backfilled = true
        }

        const now = new Date().toISOString()
        const patch =
          stage === 'retrieve'
            ? { retrieved_at: now, gross_weight_lbs: weightLbs, retrieved_by: userLabel }
            : { stripped_at: now, stripped_weight_lbs: weightLbs, stripped_by: userLabel }

        const { data, error } = await supabase
          .from('block_placements')
          .update(patch)
          .eq('id', placement.id)
          .select()
          .single()
        if (error) {
          console.error('[data] weighBlock:', error.message)
          return { ok: false, error: error.message }
        }
        upsertPlacement(toBlockPlacement(data as BlockPlacementRow))
        return { ok: true, backfilled }
      },

      saveBlockPlacement: async (id: string, patch: Partial<BlockPlacement>) => {
        if (!supabase) return { ok: false, error: 'No backend connection.' }
        const row: Record<string, unknown> = {}
        if ('fieldId' in patch) row.field_id = patch.fieldId
        if ('lat' in patch) row.lat = patch.lat
        if ('lng' in patch) row.lon = patch.lng
        if ('grossWeightLbs' in patch) row.gross_weight_lbs = patch.grossWeightLbs
        if ('strippedWeightLbs' in patch) row.stripped_weight_lbs = patch.strippedWeightLbs
        if ('placedAt' in patch) row.placed_at = patch.placedAt
        if ('retrievedAt' in patch) row.retrieved_at = patch.retrievedAt
        if ('strippedAt' in patch) row.stripped_at = patch.strippedAt
        if ('notes' in patch) row.notes = patch.notes
        if (Object.keys(row).length === 0) return { ok: true }

        const { data, error } = await supabase
          .from('block_placements')
          .update(row)
          .eq('id', id)
          .select()
          .single()
        if (error) {
          console.error('[data] saveBlockPlacement:', error.message)
          return { ok: false, error: error.message }
        }
        upsertPlacement(toBlockPlacement(data as BlockPlacementRow))
        return { ok: true }
      },

      importBlockPlacements: async (rows, season) => {
        if (!supabase) return { created: 0, updated: 0, newBlocks: 0, error: 'No backend connection.' }
        if (rows.length === 0) return { created: 0, updated: 0, newBlocks: 0 }

        // 1. Register every label not already on record, in ONE upsert.
        //    onConflict:'label' means a label that IS present comes back as
        //    itself rather than erroring, so this is safe to re-run.
        const labels = [...new Set(rows.map((r) => r.label.trim()).filter(Boolean))]
        const known = new Map(blocks.map((b) => [b.label.trim().toLowerCase(), b]))
        const missing = labels.filter((l) => !known.has(l.toLowerCase()))

        if (missing.length) {
          const { data, error } = await supabase
            .from('blocks')
            .upsert(
              missing.map((label) => ({ label })),
              { onConflict: 'label' },
            )
            .select()
          if (error) {
            console.error('[data] importBlockPlacements/blocks:', error.message)
            return { created: 0, updated: 0, newBlocks: 0, error: error.message }
          }
          const added = ((data as BlockRow[]) ?? []).map(toBlock)
          for (const b of added) known.set(b.label.trim().toLowerCase(), b)
          setBlocks((prev) => [...prev, ...added].sort((a, z) => a.label.localeCompare(z.label)))
        }

        // 2. Upsert placements on (block_id, season) — the identity the scanner
        //    uses too, so an imported block and a scanned one are ONE record.
        const alreadyPlaced = new Set(
          blockPlacements.filter((p) => p.season === season).map((p) => p.blockId),
        )
        let created = 0
        let updated = 0
        const payload: Array<Record<string, unknown>> = []
        for (const r of rows) {
          const block = known.get(r.label.trim().toLowerCase())
          if (!block) continue
          if (alreadyPlaced.has(block.id)) updated++
          else created++
          payload.push({
            block_id: block.id,
            season,
            field_id: r.fieldId,
            lat: r.lat,
            lon: r.lng,
            placed_at: r.placedAt ?? new Date().toISOString(),
          })
        }
        if (payload.length === 0) return { created: 0, updated: 0, newBlocks: missing.length }

        const { data, error } = await supabase
          .from('block_placements')
          .upsert(payload, { onConflict: 'block_id,season' })
          .select()
        if (error) {
          console.error('[data] importBlockPlacements/placements:', error.message)
          return { created: 0, updated: 0, newBlocks: missing.length, error: error.message }
        }
        for (const p of ((data as BlockPlacementRow[]) ?? []).map(toBlockPlacement)) upsertPlacement(p)
        return { created, updated, newBlocks: missing.length }
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
            // Whose work this was. Without it, progress can only ever be the
            // FIELD's progress — two crews in one quarter each reading as
            // having done all of it.
            crew_id: input.crewId ?? null,
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
      releaseTrayToShelter: async ({ trayId, shelterId, crewId, moveFrom }) => {
        if (!supabase) return { ok: false, error: 'No backend connection.' }
        const now = new Date().toISOString()

        // Moving a tray: close the old link rather than leaving two shelters
        // both claiming it.
        if (moveFrom) {
          const { error } = await supabase
            .from('shelter_tray_links')
            .delete()
            .eq('tray_id', trayId)
            .eq('shelter_id', moveFrom)
          if (error) return { ok: false, error: error.message }
          setShelterTrayLinks((prev) =>
            prev.filter((l) => !(l.trayId === trayId && l.shelterId === moveFrom)),
          )
        }

        const link = await supabase
          .from('shelter_tray_links')
          .insert({
            shelter_id: shelterId,
            tray_id: trayId,
            scanned_at: now,
            scanned_by: userLabel,
            crew_id: crewId ?? null,
          })
          .select()
          .single()
        if (link.error) {
          console.error('[data] releaseTrayToShelter/link:', link.error.message)
          return { ok: false, error: link.error.message }
        }
        setShelterTrayLinks((prev) => [toShelterTrayLink(link.data as ShelterTrayLinkRow), ...prev])

        // The other half of the same event. Done AFTER the link so a failure
        // here leaves a tray that is recorded as placed but still shown in its
        // incubator — visibly wrong, rather than invisibly lost.
        const upd = await supabase
          .from('trays')
          .update({ status: 'released', incubator_id: null, out_date: now })
          .eq('id', trayId)
          .select()
          .single()
        if (upd.error) {
          console.error('[data] releaseTrayToShelter/tray:', upd.error.message)
          return { ok: false, error: `Linked, but could not release the tray: ${upd.error.message}` }
        }
        const saved = toTray(upd.data as TrayRow)
        setTrays((prev) => prev.map((t) => (t.id === saved.id ? saved : t)))
        return { ok: true }
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
      trayInspections,
      readings,
      notifications,
      notificationPrefs,
      samples,
      trays,
      traysLoading,
      batches,
      alerts,
      costPrefsByYear,
      placedShelters,
      shelterTrayLinks,
      nestingBlocks,
      blocks,
      blockPlacements,
      crews,
      crewMembers,
      calendarEvents,
      blocksLoading,
      upsertPlacement,
      grants,
      grantTasks,
      sales,
      tasks,
      settings2,
      // Lazily-loaded sets and the signed-in identity. These were MISSING, and
      // a missing dep here does not stale one value — it freezes the whole
      // context object, because every consumer reads the same memo. The
      // Analysis section showed "Not enough data" until an unrelated fetch
      // happened to change another dep and force a recompute; `userLabel`
      // stamped `placed_by` on a block placement as null; `userId` made
      // "Join crew" answer "Sign in first" to someone who was signed in.
      // src/data/contextDeps.test.ts now fails if this list falls behind again.
      fieldAnalysis,
      fieldAnalysisLoading,
      fieldChecklist,
      fieldChecklistLoading,
      readChecklistYear,
      fieldWeather,
      blockSeasons,
      earlierInspectionsLoaded,
      userId,
      userLabel,
    ],
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
