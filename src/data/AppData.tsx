import { useMemo, useState, type ReactNode } from 'react'
import { DataContext, type DataContextValue, type NotificationPref, type TrayObservation } from './context'
import type {
  Block,
  BlockPlacement,
  Field,
  Incubator,
  IncubatorModeEvent,
  Sample,
  Tray,
  Inspection,
  TrayInspection,
  SensorReading,
  AppNotification,
  PlacedShelter,
  ShelterTrayLink,
  NestingBlock,
  Grant,
  GrantTask,
  FieldAnalysis,
  FieldWeather,
} from './types'
import type { CostPrefs } from '@/domain/cost'
import { planJoin, planTakeLead, type Crew, type CrewMember } from '@/domain/crews'
import { useSalesMock } from './useSalesMock'
import { useTasksMock } from './useTasksMock'
import { useSettings } from './useSettings'
import { parseAnalysisCsvRow } from '@/domain/analysisImport'
import { weatherKey } from '@/domain/weather'
import {
  seedFields,
  seedIncubators,
  seedInspections,
  seedTrayInspections,
  seedReadings,
  seedNotifications,
  seedSamples,
  seedTrays,
  seedBatches,
  seedAlerts,
  seedGrants,
  seedBlocks,
  seedBlockPlacements,
  seedFieldAnalysis,
} from './seed'
import { SupabaseProvider } from './SupabaseProvider'
import { isSupabaseConfigured } from './supabaseClient'

let idSeq = 1000
const nextId = (prefix: string) => `${prefix}_${++idSeq}`

/**
 * A plausible season of weather for mock mode, derived from the cache key.
 *
 * Deterministic — no Date.now(), no Math.random() — so the charts look the same
 * on every reload and the seeded correlations stay stable. It is fake data for
 * a screen with no backend, not a model of anything.
 */
function mockWeather(key: string, year: string, lat: number, lng: number): FieldWeather {
  // Spread values across a believable southern-Alberta range using the
  // coordinates and year as the only inputs.
  const wobble = (salt: number) => {
    const h = Math.abs(Math.sin((lat * 73.1 + lng * 31.7 + Number(year) + salt) * 12.9898))
    return h - Math.floor(h)
  }
  const avgTemp = 14 + wobble(1) * 6
  return {
    key,
    year,
    avgTemp,
    maxTemp: avgTemp + 7 + wobble(2) * 3,
    minTemp: avgTemp - 7 - wobble(3) * 3,
    totalPrecip: 120 + wobble(4) * 160,
    avgWind: 12 + wobble(5) * 10,
    growingDegreeDays: 900 + wobble(6) * 500,
    rainDays: Math.round(28 + wobble(7) * 22),
    flightHours: Math.round(55 + wobble(8) * 45),
  }
}

/** Mock backend: seeded in-memory state, no server required. */
function MockProvider({ children }: { children: ReactNode }) {
  const [fields, setFields] = useState<Field[]>(seedFields)
  const [incubators, setIncubators] = useState<Incubator[]>(seedIncubators)
  // Mode-change log. Live mode gets this from a database trigger; here it is
  // whatever this session has changed, so the history UI has something to show.
  const [modeEvents, setModeEvents] = useState<IncubatorModeEvent[]>([])
  const [inspections, setInspections] = useState<Inspection[]>(seedInspections)
  const [trayInspections, setTrayInspections] = useState<TrayInspection[]>(seedTrayInspections)
  const [trays, setTrays] = useState<Tray[]>(seedTrays)
  const [samples, setSamples] = useState<Sample[]>(seedSamples)
  const [readings] = useState<SensorReading[]>(seedReadings)
  const [notifications, setNotifications] = useState<AppNotification[]>(seedNotifications)
  const [costPrefsByYear, setCostPrefsByYear] = useState<Record<string, Partial<CostPrefs>>>({})
  const [placedShelters, setPlacedShelters] = useState<PlacedShelter[]>([])
  const [shelterTrayLinks, setShelterTrayLinks] = useState<ShelterTrayLink[]>([])
  const [nestingBlocks, setNestingBlocks] = useState<NestingBlock[]>([])
  const [blocks, setBlocks] = useState<Block[]>(seedBlocks)
  const [blockPlacements, setBlockPlacements] = useState<BlockPlacement[]>(seedBlockPlacements)
  const [notificationPrefs, setNotificationPrefs] = useState<Record<string, NotificationPref>>({})
  // Two crews with an iPad on one of them, so the Crews view has something to
  // show without anyone setting it up first.
  const [crews, setCrews] = useState<Crew[]>([
    { id: 'crew1', name: 'Crew 1', season: new Date().getFullYear(), active: true },
    { id: 'crew2', name: 'Crew 2', season: new Date().getFullYear(), active: true },
  ])
  const [crewMembers, setCrewMembers] = useState<CrewMember[]>([
    { id: 'cm1', crewId: 'crew1', userId: 'u_op', role: 'lead', joinedAt: new Date().toISOString(), leftAt: null },
  ])
  const [grants, setGrants] = useState<Grant[]>(seedGrants)
  const [grantTasks, setGrantTasks] = useState<GrantTask[]>([])
  const [fieldAnalysis, setFieldAnalysis] = useState<FieldAnalysis[]>(seedFieldAnalysis)
  const [fieldWeather, setFieldWeather] = useState<Record<string, FieldWeather>>({})
  const nowIso = () => new Date().toISOString()
  // Sales lives in its own hook — this file is long enough, and the slice has
  // no overlap with anything above it.
  const sales = useSalesMock()
  // The mock user switcher is the 'current user'; tasks stamp completions with it.
  const tasks = useTasksMock('u_admin')
  const settings2 = useSettings('u_admin', false)

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
      traysLoading: false,
      // Mock holds every seeded tray already — nothing to fetch.
      loadTrays: async () => {},
      batches: seedBatches,
      alerts: seedAlerts,
      trayInspections,
      addInspection: (input, trayObservations?: TrayObservation[]) => {
        const id = nextId('in')
        setInspections((prev) => [{ ...input, id }, ...prev])
        if (trayObservations?.length) {
          setTrayInspections((prev) => [
            ...trayObservations.map((o) => ({
              ...o,
              id: nextId('ti'),
              inspectionId: id,
              incubatorId: input.incubatorId,
              at: input.at,
            })),
            ...prev,
          ])
        }
      },
      // Mock seeds everything already — nothing older to fetch.
      loadEarlierInspections: async () => {},
      earlierInspectionsLoaded: true,
      crews,
      crewMembers,
      loadCrews: async () => {},
      joinCrew: async (crewId: string, asLead: boolean) => {
        const me = 'u_admin'
        const plan = planJoin(crewMembers, me, crewId)
        const now = new Date().toISOString()
        const handover = asLead ? planTakeLead(crewMembers, me, crewId) : { demote: [], promote: null }
        setCrewMembers((prev) => {
          let next = prev.map((m) => (plan.leave.includes(m.id) ? { ...m, leftAt: now } : m))
          // Demote the old lead first — one reporter per crew, same as the
          // database constraint.
          next = next.map((m) => (handover.demote.includes(m.id) ? { ...m, role: 'member' as const } : m))
          if (plan.join) {
            next.push({
              id: nextId('cm'),
              crewId,
              userId: me,
              role: asLead ? 'lead' : 'member',
              joinedAt: now,
              leftAt: null,
            })
          } else if (handover.promote) {
            next = next.map((m) => (m.id === handover.promote ? { ...m, role: 'lead' as const } : m))
          }
          return next
        })
        return { ok: true }
      },
      leaveCrew: async () => {
        const now = new Date().toISOString()
        setCrewMembers((prev) =>
          prev.map((m) => (m.userId === 'u_admin' && m.leftAt == null ? { ...m, leftAt: now } : m)),
        )
        return { ok: true }
      },
      createCrew: async (name: string) => {
        const id = nextId('crew')
        setCrews((prev) => [...prev, { id, name, season: new Date().getFullYear(), active: true }])
        return { ok: true, crewId: id }
      },
      latestReading: (incubatorId) =>
        readings
          .filter((r) => r.incubatorId === incubatorId)
          .sort((a, b) => b.at.localeCompare(a.at))[0],
      // Mock holds every seeded reading already — nothing to fetch.
      loadReadings: async () => {},
      // Mock has no trigger, so the log is whatever this session has done —
      // populated by saveIncubator below, empty on a fresh load.
      fetchModeEvents: async (incubatorId, fromIso, toIso) =>
        modeEvents
          .filter((e) => e.incubatorId === incubatorId && e.changedAt >= fromIso && e.changedAt <= toIso)
          .sort((a, b) => a.changedAt.localeCompare(b.changedAt)),
      fetchReadings: async (incubatorId, fromIso, toIso) =>
        readings
          .filter((r) => r.incubatorId === incubatorId && r.at >= fromIso && r.at <= toIso)
          .sort((a, b) => a.at.localeCompare(b.at)),
      saveField: (id, patch) =>
        setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f))),
      saveIncubator: (id, patch) => {
        // Mirror the database trigger: a mode change is logged, everything
        // else is a plain edit. Without this, mock mode could never show the
        // history UI and the screen would only be exercised in production.
        setIncubators((prev) =>
          prev.map((i) => {
            if (i.id !== id) return i
            const nextMode = patch.tempMode
            if (nextMode !== undefined && nextMode !== i.tempMode) {
              setModeEvents((evts) => [
                ...evts,
                {
                  id: `me_${evts.length + 1}`,
                  incubatorId: id,
                  fromMode: i.tempMode ?? null,
                  toMode: String(nextMode),
                  changedAt: new Date().toISOString(),
                  changedBy: null,
                  backfilled: false,
                  note: '',
                },
              ])
            }
            return { ...i, ...patch }
          }),
        )
      },
      saveSample: async (id, patch) => {
        setSamples((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)))
        return { ok: true }
      },
      createLotFromReturns: async ({ fieldId, harvestSeason, name, totalWeightLbs, notes }) => {
        const existing = samples.find(
          (x) => x.fieldId === fieldId && x.harvestSeason === harvestSeason,
        )
        if (existing) {
          setSamples((prev) =>
            prev.map((x) =>
              x.id === existing.id ? { ...x, totalWeightLbs, notes: notes ?? '' } : x,
            ),
          )
          return { ok: true, sampleId: existing.id, created: false }
        }
        const id = nextId('s')
        setSamples((prev) => [
          ...prev,
          {
            id, name, fieldId, harvestSeason, totalWeightLbs, notes: notes ?? '',
            source: '', lotNumber: '', xrayLivePct: null, xrayParasitePct: null, xrayDeadPct: null,
            totalVolumeGal: null, totalWeightKg: null, liveBeesPerLb: null, liveBeesPerKg: null,
            parasites: null, chalkbrood: null, totalTrays: null, incubatorSpace: null,
            lbsPer2Gal: null, kgPer2Gal: null, importDate: nowIso(),
          },
        ])
        return { ok: true, sampleId: id, created: true }
      },

      importSamples: async (rows) => {
        let updated = 0
        let created = 0
        setSamples((prev) => {
          const next = [...prev]
          for (const r of rows) {
            const i = next.findIndex((x) => x.name.trim().toLowerCase() === r.name.trim().toLowerCase())
            if (i >= 0) {
              next[i] = { ...next[i], ...r }
              updated++
            } else {
              next.push({
                source: '', lotNumber: '', xrayLivePct: null, xrayParasitePct: null, xrayDeadPct: null,
                totalVolumeGal: null, totalWeightLbs: null, totalWeightKg: null, liveBeesPerLb: null,
                liveBeesPerKg: null, parasites: null, chalkbrood: null, totalTrays: null,
                incubatorSpace: null, lbsPer2Gal: null, kgPer2Gal: null, notes: '',
                fieldId: null, harvestSeason: null,
                importDate: new Date().toISOString(),
                ...r,
                id: nextId('s'),
              })
              created++
            }
          }
          return next
        })
        return { updated, created }
      },
      assignTray: async ({ trayNumber, sampleId, incubatorId }) => {
        const today = new Date().toISOString().slice(0, 10)
        let created = false
        setTrays((prev) => {
          const i = prev.findIndex((t) => t.sampleId === sampleId && t.trayNumber === trayNumber)
          if (i >= 0) {
            const next = [...prev]
            next[i] = { ...next[i], incubatorId, status: 'active' }
            return next
          }
          created = true
          return [
            {
              id: nextId('t'), trayNumber, sampleId, incubationBatchId: null, incubatorId,
              weightLbs: null, liveCount: null, parasiteLevelPct: null, volumeGal: null,
              inDate: today, outDate: null, coolDate: null, status: 'active', notes: '',
            },
            ...prev,
          ]
        })
        return { ok: true, created }
      },
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

      // ── Nesting blocks (place → retrieve → strip) ────────────────────────
      blocks,
      blockPlacements,
      blocksLoading: false,
      // Mock data is already in memory; nothing to fetch.
      loadBlocks: () => Promise.resolve(),
      placeBlock: ({ label, fieldId, lat, lng, season }) => {
        const clean = label.trim()
        if (!clean) return Promise.resolve({ ok: false, created: false, error: 'That code was empty.' })
        const yr = season ?? new Date().getFullYear()

        // Register an unknown label rather than refusing the scan (see context).
        let block = blocks.find((b) => b.label.trim().toLowerCase() === clean.toLowerCase())
        const isNewBlock = !block
        if (!block) {
          block = { id: nextId('blk'), label: clean, notes: '', createdAt: nowIso() }
          const created = block
          setBlocks((prev) => [...prev, created].sort((a, z) => a.label.localeCompare(z.label)))
        }

        const existing = blockPlacements.find((p) => p.blockId === block!.id && p.season === yr)
        if (existing) {
          // Re-scanning a block already out this season corrects where it is.
          setBlockPlacements((prev) =>
            prev.map((p) => (p.id === existing.id ? { ...p, fieldId, lat, lng } : p)),
          )
          return Promise.resolve({
            ok: true,
            created: isNewBlock,
            placementId: existing.id,
            movedFromFieldId:
              existing.fieldId && existing.fieldId !== fieldId ? existing.fieldId : null,
          })
        }
        const newId = nextId('bp')
        setBlockPlacements((prev) => [
          {
            id: newId,
            blockId: block!.id,
            season: yr,
            fieldId,
            shelterId: null,
            lat,
            lng,
            placedAt: nowIso(),
            placedBy: '',
            retrievedAt: null,
            grossWeightLbs: null,
            retrievedBy: '',
            strippedAt: null,
            strippedWeightLbs: null,
            strippedBy: '',
            notes: '',
          },
          ...prev,
        ])
        return Promise.resolve({ ok: true, created: true, placementId: newId })
      },
      blockSeasons: [...new Set(blockPlacements.map((p) => p.season))]
        .sort((a, z) => z - a)
        .map((season) => {
          const rows = blockPlacements.filter((p) => p.season === season)
          return {
            season,
            placed: rows.length,
            retrieved: rows.filter((p) => p.grossWeightLbs != null).length,
            stripped: rows.filter((p) => p.strippedWeightLbs != null).length,
          }
        }),
      loadBlockHistory: async () => {},
      undoPlacement: async (placementId: string) => {
        const placement = blockPlacements.find((x) => x.id === placementId)
        if (!placement) return { ok: false, error: 'That scan is no longer in the system.' }
        if (placement.grossWeightLbs != null || placement.strippedWeightLbs != null) {
          return { ok: false, error: 'This block has been weighed since — undo would delete the weights.' }
        }
        const others = blockPlacements.filter((x) => x.blockId === placement.blockId && x.id !== placementId)
        setBlockPlacements((prev) => prev.filter((x) => x.id !== placementId))
        if (others.length === 0) setBlocks((prev) => prev.filter((b) => b.id !== placement.blockId))
        return { ok: true, blockRemoved: others.length === 0 }
      },

      weighBlock: ({ label, stage, weightLbs, season, fieldId, lat, lng }) => {
        if (!Number.isFinite(weightLbs) || weightLbs < 0)
          return Promise.resolve({ ok: false, error: 'Enter a valid weight.' })
        const clean = label.trim()
        const yr = season ?? new Date().getFullYear()
        // Missing history is created, never refused — see the seam's note.
        let backfilled = false
        let block = blocks.find((b) => b.label.trim().toLowerCase() === clean.toLowerCase())
        if (!block) {
          block = { id: nextId('blk'), label: clean, notes: '', createdAt: nowIso() }
          const made = block
          setBlocks((prev) => [...prev, made].sort((a, z) => a.label.localeCompare(z.label)))
          backfilled = true
        }
        let placement = blockPlacements.find((p) => p.blockId === block!.id && p.season === yr)
        if (!placement) {
          placement = {
            id: nextId('bp'), blockId: block.id, season: yr, fieldId: fieldId ?? null,
            shelterId: null, lat: lat ?? null, lng: lng ?? null, placedAt: null, placedBy: '',
            retrievedAt: null, grossWeightLbs: null, retrievedBy: '', strippedAt: null,
            strippedWeightLbs: null, strippedBy: '',
            notes: 'Placement created at weigh-in — the placement scan was missed.',
          }
          const made = placement
          setBlockPlacements((prev) => [made, ...prev])
          backfilled = true
        }

        const now = nowIso()
        setBlockPlacements((prev) =>
          prev.map((p) =>
            p.id === placement.id
              ? stage === 'retrieve'
                ? { ...p, retrievedAt: now, grossWeightLbs: weightLbs }
                : { ...p, strippedAt: now, strippedWeightLbs: weightLbs }
              : p,
          ),
        )
        return Promise.resolve({ ok: true, backfilled })
      },
      saveBlockPlacement: (id, patch) => {
        setBlockPlacements((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
        return Promise.resolve({ ok: true })
      },

      importBlockPlacements: (rows, season) => {
        if (rows.length === 0) return Promise.resolve({ created: 0, updated: 0, newBlocks: 0 })

        // Register unknown labels, mirroring the live provider.
        const known = new Map(blocks.map((b) => [b.label.trim().toLowerCase(), b]))
        const added: Block[] = []
        for (const r of rows) {
          const key = r.label.trim().toLowerCase()
          if (!key || known.has(key)) continue
          const b: Block = { id: nextId('blk'), label: r.label.trim(), notes: '', createdAt: nowIso() }
          known.set(key, b)
          added.push(b)
        }
        if (added.length) {
          setBlocks((prev) => [...prev, ...added].sort((a, z) => a.label.localeCompare(z.label)))
        }

        // Upsert on (blockId, season), same identity as the scanner.
        const alreadyPlaced = new Map(
          blockPlacements.filter((p) => p.season === season).map((p) => [p.blockId, p]),
        )
        let created = 0
        let updated = 0
        const updates = new Map<string, Partial<BlockPlacement>>()
        const inserts: BlockPlacement[] = []

        for (const r of rows) {
          const block = known.get(r.label.trim().toLowerCase())
          if (!block) continue
          const existing = alreadyPlaced.get(block.id)
          if (existing) {
            updated++
            updates.set(existing.id, { fieldId: r.fieldId, lat: r.lat, lng: r.lng })
          } else {
            created++
            inserts.push({
              id: nextId('bp'),
              blockId: block.id,
              season,
              fieldId: r.fieldId,
              shelterId: null,
              lat: r.lat,
              lng: r.lng,
              placedAt: r.placedAt ?? nowIso(),
              placedBy: 'import',
              retrievedAt: null,
              grossWeightLbs: null,
              retrievedBy: '',
              strippedAt: null,
              strippedWeightLbs: null,
              strippedBy: '',
              notes: '',
            })
          }
        }

        setBlockPlacements((prev) => [
          ...inserts,
          ...prev.map((p) => (updates.has(p.id) ? { ...p, ...updates.get(p.id) } : p)),
        ])
        return Promise.resolve({ created, updated, newBlocks: added.length })
      },

      // ── Season analysis ─────────────────────────────────────────────────
      fieldAnalysis,
      fieldAnalysisLoading: false,
      // Mock data is already in memory; nothing to fetch.
      loadFieldAnalysis: () => Promise.resolve(),
      fieldWeather,
      loadFieldWeather: (rows) => {
        // No network in mock mode. Derive a deterministic season per
        // coordinate+year so the weather panels have something plausible to
        // plot — varied enough to correlate against, stable across reloads.
        setFieldWeather((prev) => {
          const next = { ...prev }
          for (const r of rows) {
            if (r.lat === null || r.lng === null) continue
            const key = weatherKey(r.lat, r.lng, r.year)
            if (next[key]) continue
            next[key] = mockWeather(key, r.year, r.lat, r.lng)
          }
          return next
        })
        return Promise.resolve()
      },
      saveFieldAnalysis: (id, patch) => {
        setFieldAnalysis((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
        return Promise.resolve({ ok: true })
      },
      importFieldAnalysis: (rows) => {
        let inserted = 0
        let updated = 0
        let skipped = 0
        setFieldAnalysis((prev) => {
          const byKey = new Map(prev.map((r) => [`${r.field_name}|${r.year}`, r]))
          for (const raw of rows) {
            const parsed = parseAnalysisCsvRow(raw)
            if (!parsed) {
              skipped++
              continue
            }
            const key = `${parsed.field_name}|${parsed.year}`
            const existing = byKey.get(key)
            if (existing) {
              byKey.set(key, { ...existing, ...parsed, id: existing.id })
              updated++
            } else {
              byKey.set(key, { ...parsed, id: nextId('fa') } as FieldAnalysis)
              inserted++
            }
          }
          return [...byKey.values()]
        })
        return Promise.resolve({ inserted, updated, skipped })
      },

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
      trayInspections,
      samples,
      trays,
      readings,
      notifications,
      notificationPrefs,
      costPrefsByYear,
      placedShelters,
      shelterTrayLinks,
      nestingBlocks,
      blocks,
      blockPlacements,
      crews,
      crewMembers,
      grants,
      grantTasks,
      fieldAnalysis,
      fieldWeather,
      sales,
      tasks,
      settings2,
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
