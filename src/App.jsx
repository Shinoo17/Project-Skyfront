import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { DEV_TEST_FLIGHT_PATH, FLIGHT_RANGE_PATH, VIEWER_PATH } from './routes/paths'
import DevTestFlightRoute from './routes/DevTestFlightRoute'
import FlightRangeRoute from './routes/FlightRangeRoute'
import ViewerRoute from './routes/ViewerRoute'

// Every surface that flies a map is full-bleed; the hangar is not. One class covers both
// flight surfaces so the shell does not have to learn about each new one.
const FLIGHT_PATHS = [FLIGHT_RANGE_PATH, DEV_TEST_FLIGHT_PATH]

export default function App() {
  const isFlight = FLIGHT_PATHS.includes(useLocation().pathname)

  return (
    <main className={`viewer-shell ${isFlight ? 'is-test-flight' : ''}`}>
      <Routes>
        <Route path={VIEWER_PATH} element={<ViewerRoute />} />
        <Route path={FLIGHT_RANGE_PATH} element={<FlightRangeRoute />} />
        <Route path={DEV_TEST_FLIGHT_PATH} element={<DevTestFlightRoute />} />
        <Route path="*" element={<Navigate to={VIEWER_PATH} replace />} />
      </Routes>
    </main>
  )
}
