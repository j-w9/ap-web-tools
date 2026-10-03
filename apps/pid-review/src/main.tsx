import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LoadingProvider, installGlobalErrorReporter } from '@apwt/tool-shell'
import { App } from './App.js'

installGlobalErrorReporter()

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <LoadingProvider>
      <App />
    </LoadingProvider>
  </StrictMode>
)
