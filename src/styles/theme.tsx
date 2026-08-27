import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * Light/dark theme.
 *
 * LIGHT is the product default as of 2026-08-27. The design system was built
 * dark-first and the dark theme is still complete and supported — this is a
 * change of default, not a retirement. Near-black chrome read as severe for an
 * app people are in all day, and the rest of the TNT/GFC family is light.
 *
 * Applied by an inline script in index.html BEFORE paint. That matters more now
 * than it did: the base stylesheet is dark, so a React-level flip would show a
 * black screen on every cold load and then snap to white.
 *
 * ── Why the storage key moved ────────────────────────────────────────────────
 *
 * The old provider wrote the current theme to localStorage on MOUNT, not on
 * choice. So every person who has ever opened the app has `dark` stored,
 * whether they picked it or never touched the toggle — the two are
 * indistinguishable, and leaving the key alone would have meant nobody saw the
 * new default. The key is versioned instead, which resets everyone once. The
 * write is now tied to an actual choice, so the next time a default changes
 * this will not need doing again.
 */
export type Theme = 'dark' | 'light'

/** v2: see the note above. v1 held a value nobody necessarily chose. */
const STORAGE_KEY = 'tnt-theme-v2'

export const DEFAULT_THEME: Theme = 'light'

function readStored(): Theme {
  if (typeof localStorage === 'undefined') return DEFAULT_THEME
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'light' || v === 'dark' ? v : DEFAULT_THEME
}

/** Apply the theme to <html>: the `.on-light` class + native color-scheme. */
function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.toggle('on-light', theme === 'light')
  root.style.colorScheme = theme === 'light' ? 'light' : 'dark'
}

interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored)

  // Apply only. Persisting here is what made the old default un-changeable:
  // it recorded a preference for everyone who had merely loaded the page.
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  /** Persist on an actual choice, which is the only thing worth remembering. */
  const remember = (t: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, t)
    } catch {
      /* private mode — ignore */
    }
    return t
  }

  const setTheme = useCallback((t: Theme) => setThemeState(remember(t)), [])
  const toggle = useCallback(
    () => setThemeState((t) => remember(t === 'dark' ? 'light' : 'dark')),
    [],
  )

  return <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
