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
