import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * Light/dark theme. Dark is the product default (the design system is built
 * dark-first); light is opt-in via `class="on-light"` on the root element.
 * The choice is persisted per browser and applied before paint in index.html
 * would be ideal, but React-level is fine here since the base CSS is dark.
 */
export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'tnt-theme'

function readStored(): Theme {
  if (typeof localStorage === 'undefined') return 'dark'
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'light' ? 'light' : 'dark'
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

  useEffect(() => {
    applyTheme(theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      /* private mode — ignore */
    }
  }, [theme])

  const setTheme = useCallback((t: Theme) => setThemeState(t), [])
  const toggle = useCallback(() => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')), [])

  return <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
