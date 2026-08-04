import { useEffect, useRef, useState } from 'react'

export interface GpsFix {
  lat: number
  lng: number
  /** Radius of uncertainty in metres, as reported by the device. */
  acc: number
}

/**
 * A live GPS fix, held open while `active`.
 *
 * Kept warm rather than requested per scan: a cold `getCurrentPosition` can
 * take 10+ seconds outdoors, which would stall every placement scan. Watching
 * continuously means the fix is already there when a block is scanned.
 */
export function useGps(active: boolean): { fix: GpsFix | null; error: string | null } {
  const [fix, setFix] = useState<GpsFix | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Read inside the callback so a stale fix isn't cleared by a transient error.
  const fixRef = useRef<GpsFix | null>(null)
  fixRef.current = fix

  useEffect(() => {
    if (!active) return
    if (!('geolocation' in navigator)) {
      setError('This device has no GPS.')
      return
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy })
        setError(null)
      },
      (err) => {
        // A dropped fix mid-session is common under tree cover; keep the last
        // known position rather than blanking it, and only report hard failures.
        if (err.code === err.PERMISSION_DENIED) setError('Location permission was refused.')
        else if (!fixRef.current) setError('Waiting for a GPS fix…')
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [active])

  return { fix, error }
}
