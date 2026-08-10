/**
 * Types for the calendar mirror, so `src/domain/calendarSync.test.ts` can
 * import it and assert it still agrees with the domain.
 *
 * The runtime file is plain `.mjs` because Netlify functions are not built by
 * the app's TypeScript pipeline. This declaration exists only for the drift
 * test — nothing in `src/` imports the mirror at runtime.
 */
export declare const CALENDAR_SUMMARY_TEXT: string
export declare const CALENDAR_DESCRIPTION_TEXT: string
export declare const MILESTONES: Array<{ day: number; label: string }>

export declare function addDays(ymd: string, n: number): string
export declare function eventIdFor(incubatorId: string, day: number, label: string): string

export declare function incubationStartFor(
  incubator: { id: string; incubation_start?: string | null },
  trays: Array<{ incubator_id: string | null; status: string; in_date: string | null }>,
): string | null

export declare function milestoneEvents(
  incubators: Array<{ id: string; name?: string | null; incubation_start?: string | null; temp_mode?: string | null }>,
  trays: Array<{ incubator_id: string | null; status: string; in_date: string | null }>,
): Array<{ date: string; day: number; label: string; incubatorId: string; incubatorName: string }>

export declare function syncWindow<T extends { date: string }>(
  milestones: readonly T[],
  today: string,
  pastDays?: number,
  futureDays?: number,
): T[]
