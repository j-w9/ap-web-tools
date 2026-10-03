import { useState } from 'react'
import { Download } from 'lucide-react'
import { ErrorBanner, Section, downloadText } from '@apwt/tool-shell'
import { waypointFileText, type MissionData, type MissionSet } from '../analysis/missions.js'
import { Badge } from './common.js'

/** Upstream alerts this when a set has fewer items than its total, then saves the file anyway. */
const INCOMPLETE_MESSAGE = 'Mission incomplete'

function SetLinks({
  label,
  prefix,
  sets,
  onIncomplete
}: {
  label: string
  prefix: string
  sets: readonly MissionSet[]
  onIncomplete: () => void
}) {
  if (sets.length === 0) return null
  return (
    <div className="apwt-group">
      <span className="apwt-label">{label}</span>
      <div className="apwt-chips">
        {sets.map((set, i) => {
          const file = waypointFileText(set)
          const name = `${prefix}_${i}.txt`
          return (
            <button
              key={name}
              type="button"
              className="apwt-btn"
              onClick={() => {
                if (!file.complete) onIncomplete()
                downloadText(name, file.text)
              }}
            >
              <Download />
              {name}
              {!file.complete && <Badge tone="bad">incomplete</Badge>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Missions, fences and rally points recovered from the log, as QGC WPL 110 downloads. */
export function MissionsSection({ missions }: { missions: MissionData }) {
  const [message, setMessage] = useState<string | null>(null)
  const incomplete = (): void => setMessage(INCOMPLETE_MESSAGE)
  if (missions.missions.length === 0 && missions.fences.length === 0 && missions.rally.length === 0) return null
  return (
    <Section
      title="Missions, fences and rally points"
      help="Every set uploaded during the log, as waypoint files for Mission Planner or QGroundControl. Incomplete sets were only partly logged."
    >
      <ErrorBanner message={message} />
      <SetLinks label="Missions" prefix="waypoints" sets={missions.missions} onIncomplete={incomplete} />
      <SetLinks label="Polygon fences" prefix="fence" sets={missions.fences} onIncomplete={incomplete} />
      <SetLinks label="Rally points" prefix="rally" sets={missions.rally} onIncomplete={incomplete} />
    </Section>
  )
}
