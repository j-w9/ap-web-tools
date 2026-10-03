import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LoadingProvider, applyTheme, initialTheme, installGlobalErrorReporter } from '@apwt/tool-shell'
import { DataflashParserFacade } from './widgets/parser-facade.js'
import { App } from './App.js'
import './ui/video-overlay.css'
import { linkFormioStyles } from './ui/vendor-styles.js'

applyTheme(initialTheme())
installGlobalErrorReporter()
linkFormioStyles()

// Widget sandboxes load their log parser from the parent page (see widgets/documents.ts).
Object.assign(window, { VideoOverlayDataflashParser: DataflashParserFacade })

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <LoadingProvider>
      <App />
    </LoadingProvider>
  </StrictMode>
)
