import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LoadingProvider, applyTheme, initialTheme, installGlobalErrorReporter } from '@apwt/tool-shell'
import { App } from './App.js'

applyTheme(initialTheme())
installGlobalErrorReporter()

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <LoadingProvider>
        <App />
      </LoadingProvider>
    </StrictMode>
  )
}
