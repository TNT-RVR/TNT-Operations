import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { SessionProvider } from './auth/session'
import { DataProvider } from './data/context'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <DataProvider>
          <App />
        </DataProvider>
      </SessionProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
