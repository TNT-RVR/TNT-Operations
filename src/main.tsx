import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import App from './App'
import { Eula, Privacy } from './features/legal/LegalPages'
import { SessionProvider } from './auth/session'
import { DataProvider } from './data/context'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ThemeProvider } from './styles/theme'
import './styles/tokens.css'
import './index.css'

// Offline-capable field app: register the service worker (production builds
// only — the dev server serves modules the SW must not cache).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[sw] register failed:', e))
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ErrorBoundary label="app">
        <BrowserRouter>
          {/*
            The legal pages are matched BEFORE SessionProvider, which renders a
            login screen whenever there is no session. Intuit requires the
            licence and privacy URLs to be readable by anyone, and their
            reviewer opens them signed out — inside the provider they would
            serve a login form and fail the check. These two routes therefore
            mount with no session and no data provider at all.
          */}
          <Routes>
            <Route path="/legal/eula" element={<Eula />} />
            <Route path="/legal/privacy" element={<Privacy />} />
            <Route
              path="*"
              element={
                <SessionProvider>
                  <DataProvider>
                    <App />
                  </DataProvider>
                </SessionProvider>
              }
            />
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>,
)
