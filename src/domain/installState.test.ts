import { describe, expect, it } from 'vitest'
import { installAdvice } from './installState'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'
const ANDROID_FIREFOX =
  'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0'

describe('installAdvice', () => {
  it('says nothing to do when it is already installed', () => {
    const a = installAdvice({ ua: ANDROID_CHROME, standalone: true, canPrompt: true })
    expect(a.state).toBe('installed')
    expect(a.steps).toEqual([])
  })

  // Standalone wins even if the browser is still offering to install — being
  // asked to install an app you are using reads as a broken app.
  it('prefers installed over an offered prompt', () => {
    expect(installAdvice({ ua: IPHONE_SAFARI, standalone: true, canPrompt: false }).state).toBe('installed')
  })

  it('offers the one-tap install when Chrome has given us a prompt', () => {
    const a = installAdvice({ ua: ANDROID_CHROME, standalone: false, canPrompt: true })
    expect(a.state).toBe('prompt')
    expect(a.steps).toEqual([]) // a button does it; instructions would be noise
  })

  // The whole reason this module exists: iOS has no install API, so the button
  // has to become instructions rather than doing nothing.
  it('gives iPhone users the Share → Add to Home Screen steps', () => {
    const a = installAdvice({ ua: IPHONE_SAFARI, standalone: false, canPrompt: false })
    expect(a.state).toBe('ios')
    expect(a.steps.join(' ')).toMatch(/Share/i)
    expect(a.steps.join(' ')).toMatch(/Add to Home Screen/i)
  })

  // Chrome on iPhone is Safari underneath and cannot add to the home screen at
  // all — telling someone to tap Share there sends them looking for a menu item
  // that does not exist.
  it('sends Chrome-on-iPhone to Safari first', () => {
    const a = installAdvice({ ua: IPHONE_CHROME, standalone: false, canPrompt: false })
    expect(a.state).toBe('unsupported')
    expect(a.title).toMatch(/Safari/i)
    expect(a.steps[0]).toMatch(/Open in Safari/i)
  })

  it('falls back to the browser menu for anything else', () => {
    const a = installAdvice({ ua: ANDROID_FIREFOX, standalone: false, canPrompt: false })
    expect(a.state).toBe('unsupported')
    expect(a.steps.length).toBeGreaterThan(0)
  })

  it('always gives something to do when there is no button', () => {
    for (const ua of [IPHONE_SAFARI, IPHONE_CHROME, ANDROID_FIREFOX]) {
      const a = installAdvice({ ua, standalone: false, canPrompt: false })
      expect(a.steps.length, ua).toBeGreaterThan(0)
    }
  })
})
