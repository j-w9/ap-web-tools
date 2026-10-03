import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyTheme, initialTheme, installGlobalErrorReporter } from '@apwt/tool-shell'
import { App } from './App.js'
import './ui/vendor.css'
import './ui/dashboard.css'

applyTheme(initialTheme())
installGlobalErrorReporter()

const root = document.getElementById('root')
if (root === null) throw new Error('index.html has no #root element')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
