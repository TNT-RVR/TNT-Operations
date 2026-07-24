import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DataContext, type DataContextValue } from './context'
import type { Field, Incubator, Inspection, SensorReading } from './types'
import { supabase } from './supabaseClient'
import {
  toField,
  toIncubator,
  toInspection,
  toSensorReading,
  inspectionInsert,
  type FieldRow,
  type IncubatorRow,
  type InspectionRow,
  type SensorReadingRow,
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

  // Keep a ref of readings so the realtime handler appends without re-subscribing.
  const readingsRef = useRef<SensorReading[]>([])
  readingsRef.current = readings

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

      const [f, i, insp] = await Promise.all([
        sb.from('shelter_fields').select('*').order('updated_at', { ascending: false }),
        sb.from('incubators').select('*').order('name', { ascending: true }),
        sb.from('inspections').select('*').order('at', { ascending: false }).limit(500),
      ])
      if (cancelled) return

      if (f.error) console.error('[data] load fields:', f.error.message)
      if (i.error) console.error('[data] load incubators:', i.error.message)
      if (insp.error) console.error('[data] load inspections:', insp.error.message)

      const incs = ((i.data as IncubatorRow[]) ?? []).map(toIncubator)
      setFields(((f.data as FieldRow[]) ?? []).map(toField))
      setIncubators(incs)
      setInspections(((insp.data as InspectionRow[]) ?? []).map(toInspection))

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

    // Stream new sensor readings into local state.
    const channel = supabase
      .channel('sensor_readings')
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
    }),
    [fields, incubators, inspections, readings],
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
