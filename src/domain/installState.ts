/**
 * What to offer someone who wants the app on their phone.
 *
 * There is no single "install" button that works everywhere, and pretending
 * otherwise is what confuses people:
 *
 * - Chrome (Android, and desktop) fires `beforeinstallprompt`, which can be
 *   held and replayed from a tap. That is a real one-tap install.
 * - **iOS has no such API at all.** Safari installs only through Share → Add to
 *   Home Screen, done by hand. A button cannot do it, so on iOS the honest
 *   thing is a button that shows exactly which taps to make.
 * - Some browsers (Firefox on Android, in-app browsers, Chrome on iOS) cannot
 *   install a PWA properly at all, and the fix is to open it in a different
 *   browser rather than to keep tapping.
 *
 * So this decides which of those situations a person is in, and the card shows
 * one of them rather than a button that silently does nothing.
 */

export type InstallState =
  /** Already running as an installed app. */
  | 'installed'
  /** Chrome held an install prompt for us; one tap does it. */
  | 'prompt'
  /** iOS: Share → Add to Home Screen, by hand. */
  | 'ios'
  /** A browser that will not install this; say which one to use. */
  | 'unsupported'

export interface InstallAdvice {
  state: InstallState
  title: string
  /** Ordered steps for the person to follow. Empty when a button will do it. */
  steps: string[]
}

const isIos = (ua: string) =>
  /iphone|ipad|ipod/i.test(ua) ||
  // iPadOS 13+ reports itself as a Mac; touch points give it away.
  (/macintosh/i.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)

/** Chrome on iOS is Safari underneath and cannot add to the home screen. */
const isIosNonSafari = (ua: string) => isIos(ua) && /crios|fxios|edgios/i.test(ua)

export function installAdvice(input: {
  ua: string
  standalone: boolean
  canPrompt: boolean
}): InstallAdvice {
  const { ua, standalone, canPrompt } = input

  if (standalone) {
    return { state: 'installed', title: 'Installed on this device', steps: [] }
  }

  if (canPrompt) {
    return { state: 'prompt', title: 'Install TNT Operations', steps: [] }
  }

  if (isIosNonSafari(ua)) {
    return {
      state: 'unsupported',
      title: 'Open this page in Safari first',
      // Chrome on iPhone cannot add to the home screen — only Safari can, and
      // someone tapping an install button in Chrome will get nothing at all.
      steps: [
        'Tap the ⋯ menu and choose “Open in Safari”.',
        'In Safari, tap the Share button — the square with an arrow.',
        'Choose “Add to Home Screen”, then Add.',
      ],
    }
  }

  if (isIos(ua)) {
    return {
      state: 'ios',
      title: 'Add TNT to your home screen',
      steps: [
        'Tap the Share button at the bottom of Safari — the square with an arrow out of it.',
        'Scroll down and tap “Add to Home Screen”.',
        'Tap Add. The TNT icon appears with your other apps.',
      ],
    }
  }

  return {
    state: 'unsupported',
    title: 'Install from your browser menu',
    steps: [
      'Open your browser’s menu — usually ⋮ or ⋯ in a corner.',
      'Choose “Install app” or “Add to Home screen”.',
      'If neither is there, open this page in Chrome and try again.',
    ],
  }
}
