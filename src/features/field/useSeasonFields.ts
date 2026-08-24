/**
 * The fields a crew should see: this season's, from Season Setup when it has
 * been set up and from the map when it has not.
 *
 * A hook rather than three copies of the same `useMemo`, because the three crew
 * screens must agree — a field on the shelter screen and missing from the tray
 * screen is a crew standing in a field the app says they are not in.
 */
import { useEffect, useMemo } from 'react'
import { useData } from '@/data/context'
import { seasonFields } from '@/domain/seasonFields'
import type { Field } from '@/data/types'

export function useSeasonFields(year: string = String(new Date().getFullYear())): Field[] {
  const { fields, fieldSeasons, loadFieldSeasons } = useData()
  useEffect(() => {
    void loadFieldSeasons(year)
  }, [loadFieldSeasons, year])
  return useMemo(() => seasonFields(year, fieldSeasons, fields), [year, fieldSeasons, fields])
}
