import { TOOLS, UAV_LOG_VIEWER_ICON, toolHref, toolIcon, type ToolCategory, type ToolInfo } from '@apwt/tool-shell'
import { HomePage } from './HomePage.js'
import './home.css'

const CATEGORIES: readonly { id: ToolCategory; title: string; blurb: string }[] = [
  { id: 'logs', title: 'Log review', blurb: 'Open a .bin log from the flight controller.' },
  { id: 'setup', title: 'Setup and tuning', blurb: 'Work from parameter files, test-stand data or hardware.' },
  { id: 'simulation', title: 'Learn and explore', blurb: 'Interactive models of ArduPilot controllers.' },
  { id: 'live', title: 'Live telemetry', blurb: 'Connect to a vehicle over MAVLink.' }
]

function ToolCard({ tool }: { tool: ToolInfo }) {
  const icon = toolIcon(tool)
  const original = tool.home === 'original'
  return (
    <a className="home-card apwt-card" href={toolHref(tool, 'home')} {...(original ? { target: '_blank', rel: 'noopener' } : {})}>
      <div className="home-card__icon">{icon ? <img src={icon} alt="" loading="lazy" /> : null}</div>
      <div className="home-card__body">
        <h3 className="home-card__name">{tool.name}</h3>
        <p className="home-card__text">{tool.description}</p>
        <div className="home-card__badges">
          {!tool.stable && <span className="apwt-badge apwt-badge--gray">Work in progress</span>}
          {original && (
            <span
              className="apwt-badge apwt-badge--gray"
              title="Not ported yet: opens the original tool on firmware.ardupilot.org"
            >
              Original version
            </span>
          )}
        </div>
      </div>
    </a>
  )
}

/** The landing page: every tool from the registry, grouped by what it works on. */
export function Home() {
  return (
    <HomePage>
      {CATEGORIES.map((category) => {
        const tools = TOOLS.filter((t) => t.category === category.id)
        if (tools.length === 0) return null
        return (
          <section key={category.id} className="home-group" aria-labelledby={`group-${category.id}`}>
            <div className="home-group__head">
              <h2 id={`group-${category.id}`} className="home-group__title">
                {category.title}
              </h2>
              <p className="home-group__blurb">{category.blurb}</p>
            </div>
            <div className="home-grid">
              {tools.map((t) => (
                <ToolCard key={t.id} tool={t} />
              ))}
              {category.id === 'logs' && (
                <a className="home-card apwt-card" href="https://plot.ardupilot.org/#/" target="_blank" rel="noopener">
                  <div className="home-card__icon">
                    {UAV_LOG_VIEWER_ICON && <img src={UAV_LOG_VIEWER_ICON} alt="" loading="lazy" />}
                  </div>
                  <div className="home-card__body">
                    <h3 className="home-card__name">UAV Log Viewer</h3>
                    <p className="home-card__text">General log review with 3D flight visualisation.</p>
                    <div className="home-card__badges">
                      <span className="apwt-badge apwt-badge--gray">External</span>
                    </div>
                  </div>
                </a>
              )}
            </div>
          </section>
        )
      })}
    </HomePage>
  )
}
