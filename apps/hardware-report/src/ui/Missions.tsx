import { Download } from 'lucide-react'
import { Section, downloadText } from '@apwt/tool-shell'
import { waypointFileText, type MissionData, type MissionSet } from '../analysis/missions.js'
import { Badge } from './common.js'

function SetLinks({ label, prefix, sets }: { label: string; prefix: string; sets: readonly MissionSet[] }) {
  if (sets.length === 0) return null
  return (
    <div className="apwt-group">
      <span className="apwt-label">{label}</span>
      <div className="apwt-chips">
        {sets.map((set, i) => {
          const file = waypointFileText(set)
          const name = `${prefix}_${i}.txt`
          return (
            <button key={name} type="button" className="apwt-btn" onClick={() => downloadText(name, file.text)}>
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
  if (missions.missions.length === 0 && missions.fences.length === 0 && missions.rally.length === 0) return null
  return (
    <Section
      title="Missions, fences and rally points"
      help="Every set uploaded during the log, as waypoint files for Mission Planner or QGroundControl. Incomplete sets were only partly logged."
    >
      <SetLinks label="Missions" prefix="waypoints" sets={missions.missions} />
      <SetLinks label="Polygon fences" prefix="fence" sets={missions.fences} />
      <SetLinks label="Rally points" prefix="rally" sets={missions.rally} />
    </Section>
  )
}
