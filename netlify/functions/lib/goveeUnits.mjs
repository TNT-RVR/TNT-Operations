/**
 * Govee temperatures, in the unit they are actually sent in.
 *
 * The Govee platform API (v2) reports `sensorTemperature` in FAHRENHEIT. The
 * poller used to guess instead — "a value above 50 must be °F" — inherited from
 * the desktop app, where it held because incubators run warm.
 *
 * The guess fails for every reading at or below 10 °C, because 10 °C is 50 °F.
 * A real 9.7 °C arrives as 49.46, is judged "not above 50", and is stored as
 * 49.46 °C. Nothing in the data is wrong except the unit, so the readings look
 * like an incubator spiking to 50 °C and dropping straight back.
 *
 * It surfaced in September when incubators went into cool storage and started
 * living below 10 °C, but it was already there: Incubator 6's "heat event" on
 * 2026-08-03 was the same thing, the room hovering right on 10 °C and flipping
 * across the boundary every few readings. Established from the data — every
 * stored 42–50 converts to 5.7–10.0 °C and sits between genuinely cold
 * neighbours, while no real reading has ever exceeded 37.7 °C.
 */

/**
 * Govee sends either plain values (55.76) or integers in hundredths (5576).
 *
 * The line between them used to be 100, which is the same kind of guess as the
 * Fahrenheit one: a plain 101 °F — 38.3 °C, a hot incubator — would have been
 * read as 1.01. Hundredths for anything above freezing start at 3200, so 200
 * separates the two with nothing real in between.
 */
export function goveeRaw(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  return raw > 200 ? raw / 100 : raw
}

/** °F to °C, to two decimals — the resolution the sensor actually reports. */
export function fToC(f) {
  if (f == null || !Number.isFinite(f)) return null
  return Math.round((((f - 32) * 5) / 9) * 100) / 100
}

/**
 * A v2 `sensorTemperature` value, in Celsius.
 *
 * Always converted. There is no threshold here on purpose: a threshold is the
 * bug, and a correct conversion does not need one at any temperature.
 */
export function v2TempC(raw) {
  return fToC(goveeRaw(raw))
}
