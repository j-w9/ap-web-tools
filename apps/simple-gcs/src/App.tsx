import { useCallback, useState, useSyncExternalStore } from 'react'
import { Crosshair, MonitorPlay, PictureInPicture2 } from 'lucide-react'
import { ControlGroup, RailCard, Section, ToolPage } from '@apwt/tool-shell'
import type { AppSettingsStore } from './app-settings.js'
import { armCommand, CONFIRMATIONS, disarmCommand, guardedCommand, type GuardedCommand } from './commands/commands.js'
import type { KeyValueStore } from './link/storage.js'
import type { GcsSession } from './session.js'
import { formatStatus } from './vehicle/status-log.js'
import { openVideoWindow } from './video/popup.js'
import { applyVideoSettings, loadVideoConfig, webRtcOptions, type VideoConfig } from './video/video-config.js'
import { ConfirmDialog } from './ui/ConfirmDialog.js'
import { ConnectionPanel } from './ui/ConnectionPanel.js'
import { GcsMap } from './ui/GcsMap.js'
import { MessagesLog } from './ui/MessagesLog.js'
import { ParameterEditor } from './ui/ParameterEditor.js'
import { SettingsPanel } from './ui/SettingsPanel.js'
import { TelemetryPanel } from './ui/TelemetryPanel.js'
import { VideoPanel } from './ui/VideoPanel.js'
import type { VideoProtocol } from './ui/VideoSurface.js'
import './ui/simple-gcs.css'

export interface AppProps {
  readonly session: GcsSession
  readonly settings: AppSettingsStore
  readonly local: KeyValueStore
}

type VideoMode = 'closed' | 'hidden' | 'shown'

export function App({ session, settings, local }: AppProps) {
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const app = useSyncExternalStore(
    (cb) => settings.subscribe(cb),
    () => settings.current
  )
  const [recenter, setRecenter] = useState(0)
  const [confirm, setConfirm] = useState<GuardedCommand | null>(null)
  const [paramsOpen, setParamsOpen] = useState(false)
  const [videoMode, setVideoMode] = useState<VideoMode>('closed')
  const [protocol, setProtocol] = useState<VideoProtocol>('webrtc')
  const [videoConfig, setVideoConfig] = useState<VideoConfig>(() => loadVideoConfig(local, window.location))
  const toast = useCallback((m: string) => session.toast(m), [session])
  const reposition = useCallback((lat: number, lng: number) => session.reposition(lat, lng), [session])

  const toggleVideo = (): void => {
    if (videoMode === 'shown') setVideoMode('hidden')
    else {
      if (videoMode === 'closed') setProtocol('webrtc')
      setVideoMode('shown')
    }
  }
  const newWindow = (): void => openVideoWindow(window, webRtcOptions(videoConfig))
  const vehicle = snap.vehicle

  const rail = (
    <RailCard>
      <ConnectionPanel session={session} snap={snap} />
      <ControlGroup label="Telemetry">
        <TelemetryPanel snap={snap} showGPSNumSats={app.showGPSNumSats} />
      </ControlGroup>
      <ControlGroup label="Vehicle">
        <div className="gcs-commands">
          <button type="button" id="armBtn" className="gcs-cmd gcs-cmd--arm" onClick={() => session.sendCommand(armCommand())}>
            Arm
          </button>
          <button
            type="button"
            id="disarmBtn"
            className="gcs-cmd gcs-cmd--disarm"
            onClick={() => session.sendCommand(disarmCommand())}
          >
            Disarm
          </button>
          <button type="button" id="rtlBtn" className="gcs-cmd gcs-cmd--mode" onClick={() => session.sendSetMode('RTL')}>
            RTL
          </button>
          <button type="button" id="loiterBtn" className="gcs-cmd gcs-cmd--mode" onClick={() => session.sendSetMode('LOITER')}>
            Loiter
          </button>
        </div>
        <div className="gcs-menu">
          <button type="button" className="apwt-btn" onClick={() => session.fenceEnable(false)}>
            Disable fence
          </button>
          <button type="button" className="apwt-btn" onClick={() => session.fenceEnable(true)}>
            Enable fence
          </button>
          <button type="button" className="apwt-btn" onClick={() => setConfirm('reboot')}>
            Reboot
          </button>
          <button type="button" className="apwt-btn" onClick={() => setConfirm('forceDisarm')}>
            Force disarm
          </button>
          <button type="button" className="apwt-btn" onClick={() => setConfirm('forceArm')}>
            Force arm
          </button>
        </div>
      </ControlGroup>
      <ControlGroup label="Parameters">
        <button type="button" className="apwt-btn apwt-btn--block" onClick={() => setParamsOpen(true)}>
          Edit parameters
        </button>
      </ControlGroup>
    </RailCard>
  )

  return (
    <ToolPage
      title="Simple GCS"
      intro="A touch-friendly ground station for ArduPilot boats and rovers over a MAVLink WebSocket relay, with signing, map, commands, MAVFTP fence, mission and parameters, and video."
      readmeUrl="https://github.com/ArduPilot/WebTools/tree/main/SimpleGCS"
      rail={rail}
    >
      <Section
        title="Map"
        help="Hold a point on the map for 600 ms to send the vehicle there in Guided mode."
        tools={
          <>
            <button type="button" className="apwt-btn" onClick={() => setRecenter((n) => n + 1)}>
              <Crosshair /> Recenter
            </button>
            <button type="button" className="apwt-btn" onClick={() => session.fetchFence()}>
              Fetch fence
            </button>
            <button type="button" className="apwt-btn" onClick={() => session.fetchMission()}>
              Fetch mission
            </button>
            <button type="button" className="apwt-btn" onClick={toggleVideo}>
              <PictureInPicture2 /> Video inset
            </button>
            <button type="button" className="apwt-btn" onClick={newWindow}>
              <MonitorPlay /> Video in new window
            </button>
          </>
        }
      >
        <GcsMap
          marker={snap.marker}
          centerRequest={snap.centerRequest}
          recenterRequest={recenter}
          stale={snap.stale}
          target={snap.target}
          fences={snap.fences}
          fenceEnabled={snap.fenceEnabled}
          mission={snap.mission}
          tiles={settings.tileProvider}
          googleKey={app.googleKey}
          showGrid={app.showGrid}
          showLocation={app.showLocation}
          onLongPress={reposition}
          toast={toast}
        >
          {videoMode !== 'closed' && (
            <VideoPanel
              hidden={videoMode === 'hidden'}
              protocol={protocol}
              config={videoConfig}
              onProtocol={setProtocol}
              onNewWindow={newWindow}
              onSettings={(answers) => {
                const next = applyVideoSettings(videoConfig, answers, local)
                if (next !== null) setVideoConfig(next)
              }}
              onClose={() => setVideoMode('closed')}
            />
          )}
        </GcsMap>
      </Section>
      <Section
        title="Messages"
        help="Status text from the vehicle and command errors, newest at the bottom. The last 500 messages are kept."
      >
        <MessagesLog lines={snap.statusLog.map(formatStatus)} />
      </Section>
      <Section
        title="Settings"
        help="Map tiles, display options and what to fetch when a vehicle connects. Saved in this browser."
      >
        <SettingsPanel store={settings} settings={app} toast={toast} />
      </Section>

      <ParameterEditor
        client={vehicle?.params ?? null}
        vehicle={vehicle?.paramVehicle ?? 'Rover'}
        everDisconnected={snap.paramEpoch > 0}
        open={paramsOpen}
        onClose={() => setParamsOpen(false)}
      />

      {confirm !== null && (
        <ConfirmDialog
          text={CONFIRMATIONS[confirm]}
          onOk={() => {
            setConfirm(null)
            session.sendCommand(guardedCommand(confirm))
          }}
          onCancel={() => setConfirm(null)}
        />
      )}

      <div className="gcs-toasts" aria-live="polite">
        {snap.toasts.map((t) => (
          <div key={t.id} className="gcs-toast">
            {t.text}
          </div>
        ))}
      </div>
    </ToolPage>
  )
}
