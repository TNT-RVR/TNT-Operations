/**
 * Is this GPS fix good enough to record as where a shelter went?
 *
 * A placement's fix becomes the shelter's position on the map for the rest of
 * the season — it is what a tray crew navigates to and what a later map shows
 * as reality. A bad fix is therefore worse than no fix: no fix falls back to
 * the planned pin, which is approximately right, while a bad one puts a
 * shelter in the next quarter and looks exactly as authoritative.
 *
 * What this deliberately does NOT do is stop the work. Every refusal here has
 * a way through — take the fix again, or record the planned position instead —
 * because a crew standing in a field with shelters on the trailer must never
 * be locked out by a phone that cannot see the sky.
 */

export interface Fix {
  lat: number
  lng: number
  /** Reported accuracy in metres. */
  acc: number
}

/**
 * Fixes worse than this are not a location, they are a neighbourhood.
 *
 * Shelters sit about 20 m apart, so a 50 m fix cannot say which one you are
 * standing at. Phones report this honestly under a canopy or on a cold start.
 */
export const MAX_ACCURACY_M = 50

/**
 * How far from its planned pin a shelter may be placed before it is suspicious.
 *
 * Crews move shelters around slough edges and wheel tracks all the time, so
 * this is generous. It is here to catch the fix that lands 800 m away, not to
 * police a 30 m detour.
 */
export const MAX_DRIFT_M = 200

export type FixVerdict =
  | { ok: true; reason: null }
  | { ok: false; reason: 'outside-field' | 'inaccurate' | 'far-from-pin'; message: string }

export interface FixCheck {
  /** The fix being judged. Null means the phone has none — allowed. */
  fix: Fix | null
  /** Whether the fix falls inside THIS field's boundary. Null when unknown. */
  insideField: boolean | null
  /** Metres from the pin being placed, when both are known. */
  driftM: number | null
  /** The field's name, for saying something useful. */
  fieldName?: string
}

/**
 * Judge a fix.
 *
 * No fix at all passes: that path already records the planned position and is
 * honest about it. What fails is a fix that claims to be a measurement while
 * being obviously wrong — outside the field, too coarse to identify a shelter,
 * or implausibly far from the pin being marked.
 */
export function checkPlacementFix({
  fix,
  insideField,
  driftM,
  fieldName,
}: FixCheck): FixVerdict {
  if (!fix) return { ok: true, reason: null }

  // Order matters: accuracy first, because a 500 m fix will often ALSO read as
  // outside the field, and "your GPS is poor" is the more actionable of the
  // two things to be told.
  if (Number.isFinite(fix.acc) && fix.acc > MAX_ACCURACY_M) {
    return {
      ok: false,
      reason: 'inaccurate',
      message:
        `Your location is only accurate to about ${Math.round(fix.acc)} m, which cannot tell ` +
        `one shelter from the next. Wait for a better fix and mark it again.`,
    }
  }

  if (insideField === false) {
    return {
      ok: false,
      reason: 'outside-field',
      message:
        `Your location is outside ${fieldName ?? 'this field'}. Recording it would put this ` +
        `shelter somewhere it is not. Stand at the shelter and mark it again.`,
    }
  }

  if (driftM != null && driftM > MAX_DRIFT_M) {
    return {
      ok: false,
      reason: 'far-from-pin',
      message:
        `That is ${Math.round(driftM)} m from the pin you are placing — further than a shelter ` +
        `normally moves. Check you are at the right one and mark it again.`,
    }
  }

  return { ok: true, reason: null }
}
