import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { LoadingProvider, applyTheme, initialTheme, installGlobalErrorReporter } from '@apwt/tool-shell'
import { systemClock } from './clock.js'
import { configuredTitle, loadConfig } from './config.js'
import { AppSettingsStore } from './app-settings.js'
import { browserSocket } from './link/socket.js'
import { webStore } from './link/storage.js'
import { GcsSession } from './session.js'
import { VIDEO_HASH } from './video/popup.js'

applyTheme(initialTheme())
installGlobalErrorReporter()

const root = createRoot(document.getElementById('root') ?? document.body)

if (window.location.hash === VIDEO_HASH) {
  // The separate video window (upstream `video.html`) shares this page.
  const VideoWindow = lazy(() => import('./ui/VideoWindow.js').then((m) => ({ default: m.VideoWindow })))
  document.title = 'Video'
  root.render(
    <StrictMode>
      <Suspense fallback={null}>
        <VideoWindow />
      </Suspense>
    </StrictMode>
  )
} else {
  void start()
}

async function start(): Promise<void> {
  const config = await loadConfig(new URL('config.json', window.location.href))
  document.title = configuredTitle(config) ?? 'Simple GCS Map'
  const local = webStore(() => window.localStorage)
  const settings = new AppSettingsStore(local, config)
  // Settings are always on screen here; upstream applies this when its Settings popover opens.
  settings.onSettingsOpened()
  const session = new GcsSession({
    clock: systemClock,
    openSocket: browserSocket,
    local,
    session: webStore(() => window.sessionStorage),
    locks: 'locks' in navigator ? navigator.locks : undefined,
    randomUint32: () => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0,
    config,
    settings
  })
  const { App } = await import('./App.js')
  root.render(
    <StrictMode>
      <LoadingProvider>
        <App session={session} settings={settings} local={local} />
      </LoadingProvider>
    </StrictMode>
  )
  await session.start()
}
