import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
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
          <SessionProvider>
            <DataProvider>
              <App />
            </DataProvider>
          </SessionProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>,
)
