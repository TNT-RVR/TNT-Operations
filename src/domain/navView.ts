/**
 * Camera behaviour for the field's driving view — the tilted, heading-up
 * display a tractor GPS gives you, where the ground ahead fills most of the
 * screen and what is behind you does not matter.
 *
 * The whole difficulty is HEADING. A phone offers two sources and both lie in
 * different ways:
 *
 *  - GPS course over ground is accurate while moving and meaningless while
 *    stopped — the fix wanders a metre or two and the reported course spins.
 *  - The compass is available at a standstill but swings near metal, which a
 *    tractor cab is made of.
 *
 * So: use course while moving, hold the last good heading while stopped, and
 * smooth what is shown. A map that spins while you sit still is worse than one
 * that is a second late.
 */

/** Below this, "movement" is GPS noise rather than travel. Metres/second. */
export const MOVING_MPS = 0.7

/** How much of a new heading to take per fix, 0–1. Lower is smoother. */
const SMOOTHING = 0.35

/** Shortest signed turn from a to b, in degrees (−180…180]. */
export function headingDelta(a: number, b: number): number {
  let d = ((b - a + 540) % 360) - 180
  // (−180, 180]: treat an exact half-turn as positive so it can't oscillate.
  if (d === -180) d = 180
  return d
}

/**
 * The heading to draw, given the last one and a new fix.
 *
 * Returns the previous heading unchanged when the fix says nothing useful —
 * stopped, or no course reported — so the view holds still instead of spinning.
 */
export function nextHeading(
  previous: number | null,
  fix: { heading?: number | null; speed?: number | null },
): number | null {
  const { heading, speed } = fix
  const moving = speed != null && speed >= MOVING_MPS
  const usable = heading != null && Number.isFinite(heading) && moving
  if (!usable) return previous
  const h = ((heading % 360) + 360) % 360
  if (previous == null) return h
  // Turn the short way round, so 350° → 10° goes forwards through north
  // rather than sweeping the long way back through south.
  return (previous + headingDelta(previous, h) * SMOOTHING + 360) % 360
}

export interface CameraTarget {
  center: [number, number]
  zoom: number
  pitch: number
  bearing: number
}

export interface CameraInputs {
  lng: number
  lat: number
  /** Smoothed heading, or null when it isn't known yet. */
  heading: number | null
  /** 'drive' is the tilted heading-up view; 'overhead' is flat and north-up. */
  mode: 'drive' | 'overhead'
  /** What the map is on now, so an unknown heading doesn't snap it to north. */
  currentBearing: number
}

/** Zoom levels: close enough to see the next shelter, wide enough to aim. */
const DRIVE_ZOOM = 17.5
const OVERHEAD_ZOOM = 16
/** Tilt. Steeper shows more of what is ahead and less of where you are. */
const DRIVE_PITCH = 60

/** Where the camera should be for this fix. */
export function cameraFor(input: CameraInputs): CameraTarget {
  const { lng, lat, heading, mode, currentBearing } = input
  if (mode === 'overhead') {
    return { center: [lng, lat], zoom: OVERHEAD_ZOOM, pitch: 0, bearing: 0 }
  }
  return {
    center: [lng, lat],
    zoom: DRIVE_ZOOM,
    pitch: DRIVE_PITCH,
    // Hold the current bearing until a heading is known. Snapping to north the
    // moment you stop would throw the view away at the worst time.
    bearing: heading ?? currentBearing,
  }
}

/**
 * Is this camera move big enough to bother with?
 *
 * Every fix arriving as an animation makes the map judder and drains the
 * battery; a fix that has barely changed is not worth redrawing.
 */
export function shouldMoveCamera(
  from: { center: [number, number]; bearing: number },
  to: CameraTarget,
  { metresPerDegree = 111_320 } = {},
): boolean {
  const dLng = (to.center[0] - from.center[0]) * metresPerDegree * Math.cos((to.center[1] * Math.PI) / 180)
  const dLat = (to.center[1] - from.center[1]) * metresPerDegree
  const moved = Math.hypot(dLng, dLat)
  const turned = Math.abs(headingDelta(from.bearing, to.bearing))
  return moved > 1.5 || turned > 2
}
