import { describe, it, expect } from 'vitest'
import { navigationUrl } from './navLink'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120'

describe('navigationUrl', () => {
  it('hands an iPhone straight to Apple Maps', () => {
    // The Google URL opens a WEB PAGE on iOS unless the app is installed —
    // a poor result for someone in a truck.
    expect(navigationUrl(49.83, -111.6, IPHONE)).toContain('maps.apple.com')
    expect(navigationUrl(49.83, -111.6, IPHONE)).toContain('daddr=49.830000,-111.600000')
  })

  it('treats an iPad as Apple, even though it claims to be a Mac', () => {
    // iPadOS 13+ reports 'Macintosh'. The crews' devices are iPads.
    expect(navigationUrl(49.83, -111.6, IPAD)).toContain('maps.apple.com')
  })

  it('uses Google elsewhere, which opens the app on Android', () => {
    const url = navigationUrl(49.83, -111.6, ANDROID)
    expect(url).toContain('google.com/maps/dir/')
    expect(url).toContain('destination=49.830000,-111.600000')
    expect(url).toContain('travelmode=driving')
  })

  it('keeps enough decimals to find a gate', () => {
    // Six places is ~0.1 m. Four would put you in the wrong part of a quarter.
    expect(navigationUrl(49.8312345, -111.6098765, ANDROID)).toContain('49.831235,-111.609876')
  })
})
