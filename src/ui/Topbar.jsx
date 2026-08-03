import { Maximize, PlaneTakeoff } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import { FLIGHT_RANGE_PATH, VIEWER_PATH } from '../routes/paths'

// `kicker` lets a surface name itself — the dev pages are not the hangar and not the
// sortie, and saying so is the only chrome they need.
export default function Topbar({ onFullscreen, kicker }) {
  const navigate = useNavigate()
  const isFlightRange = useLocation().pathname === FLIGHT_RANGE_PATH

  return (
    <header className="topbar">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true"><i /><i /></span>
        <div>
          <strong>F-22 <em>RAPTOR</em></strong>
          <small>{kicker ?? (isFlightRange ? 'COMBAT TRAINING RANGE' : 'MISSION HANGAR')}</small>
        </div>
      </div>

      <button
        type="button"
        className={`test-flight-button ${isFlightRange ? 'is-active' : ''}`}
        aria-pressed={isFlightRange}
        onClick={() => navigate(isFlightRange ? VIEWER_PATH : FLIGHT_RANGE_PATH)}
      >
        <PlaneTakeoff size={16} strokeWidth={1.7} />
        <span>{isFlightRange ? 'Return hangar' : 'Launch sortie'}</span>
        <i aria-hidden="true" />
      </button>

      <button type="button" className="icon-button fullscreen-button" onClick={onFullscreen} aria-label="เต็มจอ">
        <Maximize size={18} />
      </button>
    </header>
  )
}
