import { describe, expect, it } from 'vitest'
import {
  AIR_O2_PCT,
  COMMANDS,
  DEFAULT_DEADBAND_PCT,
  DEFAULT_SETPOINT_PCT,
  chamberVerdict,
  commandByWire,
  deadbandCommand,
  isSilent,
  parseTelemetry,
  setpointCommand,
  toTenths,
} from './hypoxia'

/** A real line, exactly as TNT2_NANO.ino prints it. */
const LINE =
  '{"pod":1,"o2":10.4,"t":4.2,"rh":38,"v1":0,"v2":0,"blow":0,"circ":60,"purge":0,"maint":0,"w":0,"e":0}'

describe('parseTelemetry', () => {
  it('reads the firmware line', () => {
    expect(parseTelemetry(LINE)).toEqual({
      pod: 1,
      o2Pct: 10.4,
      tempC: 4.2,
      rhPct: 38,
      valve1: false,
      valve2: false,
      blowerDuty: 0,
      circulationDuty: 60,
      purging: false,
      maintenance: false,
      warn: false,
      error: false,
    })
  })

  it('reads the flags as flags', () => {
    const r = parseTelemetry(
      '{"pod":2,"o2":9.8,"t":3.9,"rh":41,"v1":1,"v2":0,"blow":200,"circ":255,"purge":1,"maint":0,"w":1,"e":0}',
    )!
    expect(r.pod).toBe(2)
    expect(r.valve1).toBe(true)
    expect(r.purging).toBe(true)
    expect(r.warn).toBe(true)
    expect(r.error).toBe(false)
    expect(r.blowerDuty).toBe(200)
  })

  /*
   * The reason this returns null rather than a partial reading: 0% oxygen is a
   * readable number and a catastrophic one. A chamber whose state cannot be
   * read must not arrive looking like a chamber that is empty of air.
   */
  it('refuses a line with no oxygen figure rather than calling it zero', () => {
    expect(parseTelemetry('{"pod":1,"t":4.2,"rh":38}')).toBeNull()
    expect(parseTelemetry('{"pod":1,"o2":"","t":4.2,"rh":38}')).toBeNull()
  })

  it('refuses an impossible oxygen reading', () => {
    expect(parseTelemetry('{"o2":-1,"t":4,"rh":38}')).toBeNull()
    expect(parseTelemetry('{"o2":120,"t":4,"rh":38}')).toBeNull()
  })

  it('survives junk on the wire', () => {
    expect(parseTelemetry('not json')).toBeNull()
    expect(parseTelemetry('')).toBeNull()
    expect(parseTelemetry(null)).toBeNull()
  })

  it('takes an already-parsed object too, since MQTT may hand one over', () => {
    expect(parseTelemetry({ o2: 10, t: 4, rh: 40 })?.o2Pct).toBe(10)
  })
})

describe('toTenths', () => {
  /*
   * The trap this exists for. The firmware parses SP= and DB= as TENTHS, so
   * `SP=100` is 10.0%. Sending the percent figure straight through would set
   * the target to 1.0% oxygen and the firmware would accept it silently.
   */
  it('converts percent to the tenths the firmware expects', () => {
    expect(toTenths(10)).toBe(100)
    expect(toTenths(10.5)).toBe(105)
    expect(toTenths(1)).toBe(10)
  })

  it('rounds rather than truncating', () => {
    expect(toTenths(10.44)).toBe(104)
    expect(toTenths(10.46)).toBe(105)
  })
})

describe('setpointCommand', () => {
  it('builds the wire form the firmware matches', () => {
    expect(setpointCommand(10)).toMatchObject({ wire: 'SP=100', risk: 'setpoint' })
  })

  // The firmware clamps nothing here, so this is the only thing standing
  // between a typo and an atmosphere that holds nothing alive.
  it('refuses a setpoint below survivable', () => {
    expect(setpointCommand(0)).toHaveProperty('error')
    expect(setpointCommand(0.5)).toHaveProperty('error')
  })

  it('refuses a setpoint above air, which the chamber cannot reach anyway', () => {
    expect(setpointCommand(25)).toHaveProperty('error')
  })

  it('mentions ambient air, so the number has something to sit against', () => {
    const r = setpointCommand(50) as { error: string }
    expect(r.error).toContain(String(AIR_O2_PCT))
  })
})

describe('deadbandCommand', () => {
  it('builds the wire form', () => {
    expect(deadbandCommand(1)).toMatchObject({ wire: 'DB=10' })
  })

  // The firmware floors this at 1 tenth; zero would have the chamber chasing
  // its own noise.
  it('refuses zero', () => {
    expect(deadbandCommand(0)).toHaveProperty('error')
  })

  it('refuses a band so wide the setpoint stops meaning anything', () => {
    expect(deadbandCommand(9)).toHaveProperty('error')
  })
})

describe('the command vocabulary', () => {
  it('marks the ones that bypass the control loop as manual', () => {
    for (const wire of ['V1=ON', 'V2=ON', 'SERVO=OPEN', 'MAINT=ON']) {
      expect(commandByWire(wire)?.risk, wire).toBe('manual')
    }
  })

  it('marks calibration separately, since it takes the sensor out of service', () => {
    expect(commandByWire('CAL=AIR')?.risk).toBe('calibration')
    expect(commandByWire('CAL=CHAMBER')?.risk).toBe('calibration')
  })

  it('gives every command a hint saying what it does to the chamber', () => {
    for (const c of COMMANDS) expect(c.hint.length, c.wire).toBeGreaterThan(20)
  })

  it('is case-insensitive on the way in, since the firmware upper-cases anyway', () => {
    expect(commandByWire('purge')?.wire).toBe('PURGE')
  })
})

describe('chamberVerdict', () => {
  const at = (o: Partial<Parameters<typeof chamberVerdict>[0]>) =>
    ({ ...parseTelemetry(LINE)!, ...o })

  it('is holding inside the deadband', () => {
    expect(chamberVerdict(at({ o2Pct: 10.4 }))).toBe('in-band')
    expect(chamberVerdict(at({ o2Pct: DEFAULT_SETPOINT_PCT + DEFAULT_DEADBAND_PCT }))).toBe('in-band')
  })

  it('calls it above or below outside the band', () => {
    expect(chamberVerdict(at({ o2Pct: 12 }))).toBe('above')
    expect(chamberVerdict(at({ o2Pct: 8 }))).toBe('below')
  })

  /*
   * The ordering is the point. A chamber at its setpoint while reporting an
   * error is not holding — its reading cannot be trusted. And in maintenance
   * the loop is not running, so being at target is a coincidence, not evidence.
   */
  it('puts a fault above a good-looking number', () => {
    expect(chamberVerdict(at({ o2Pct: 10, error: true }))).toBe('fault')
  })

  it('puts maintenance above the band', () => {
    expect(chamberVerdict(at({ o2Pct: 10, maintenance: true }))).toBe('maintenance')
  })

  it('shows purging rather than the band it is passing through', () => {
    expect(chamberVerdict(at({ o2Pct: 15, purging: true }))).toBe('purging')
  })

  it('honours a setpoint that is not the default', () => {
    expect(chamberVerdict(at({ o2Pct: 5 }), 5, 1)).toBe('in-band')
    expect(chamberVerdict(at({ o2Pct: 10.4 }), 5, 1)).toBe('above')
  })
})

describe('isSilent', () => {
  const now = new Date('2026-08-29T12:00:00Z')

  it('is fine with a fresh reading', () => {
    expect(isSilent('2026-08-29T11:58:00Z', now)).toBe(false)
  })

  // The bridge publishes at least every 15s, so ten minutes of nothing means
  // the Nano, the ESP32 or the Wi-Fi has stopped.
  it('calls a chamber silent after ten minutes', () => {
    expect(isSilent('2026-08-29T11:40:00Z', now)).toBe(true)
  })

  it('treats never-heard-from as silent', () => {
    expect(isSilent(null, now)).toBe(true)
    expect(isSilent('nonsense', now)).toBe(true)
  })
})
