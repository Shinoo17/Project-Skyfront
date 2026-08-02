import { Maximize, PlaneTakeoff } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import { TEST_FLIGHT_PATH, VIEWER_PATH } from '../routes/paths'

export default function Topbar({ onFullscreen }) {
  const navigate = useNavigate()
  const isTestFlight = useLocation().pathname === TEST_FLIGHT_PATH

  return (
    <header className="topbar">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true"><i /><i /></span>
        <div>
          <strong>F–22 <em>RAPTOR</em></strong>
          <small>{isTestFlight ? 'MOUNTAIN FLIGHT RANGE' : 'TACTICAL AIRFRAME VIEWER'}</small>
        </div>
      </div>

      <button
        type="button"
        className={`test-flight-button ${isTestFlight ? 'is-active' : ''}`}
        aria-pressed={isTestFlight}
        onClick={() => navigate(isTestFlight ? VIEWER_PATH : TEST_FLIGHT_PATH)}
      >
        <PlaneTakeoff size={16} strokeWidth={1.7} />
        <span>{isTestFlight ? 'Airframe view' : 'Test flight'}</span>
        <i aria-hidden="true" />
      </button>

      <button type="button" className="icon-button fullscreen-button" onClick={onFullscreen} aria-label="เต็มจอ">
        <Maximize size={18} />
      </button>
    </header>
  )
}
