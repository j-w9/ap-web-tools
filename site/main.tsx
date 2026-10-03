import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyTheme, initialTheme, installGlobalErrorReporter } from '@apwt/tool-shell'
import { Home } from './Home.js'

applyTheme(initialTheme())
installGlobalErrorReporter()

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Home />
  </StrictMode>
)
