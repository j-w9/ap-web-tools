import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LoadingProvider, applyTheme, initialTheme, installGlobalErrorReporter } from '@apwt/tool-shell'
import { App } from './App.js'
import './ui/stream-stats.css'

applyTheme(initialTheme())
installGlobalErrorReporter()

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <LoadingProvider>
      <App />
    </LoadingProvider>
  </StrictMode>
)
