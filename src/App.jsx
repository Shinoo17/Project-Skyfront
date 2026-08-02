import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { TEST_FLIGHT_PATH, VIEWER_PATH } from './routes/paths'
import TestFlightRoute from './routes/TestFlightRoute'
import ViewerRoute from './routes/ViewerRoute'

export default function App() {
  const isTestFlight = useLocation().pathname === TEST_FLIGHT_PATH

  return (
    <main className={`viewer-shell ${isTestFlight ? 'is-test-flight' : ''}`}>
      <Routes>
        <Route path={VIEWER_PATH} element={<ViewerRoute />} />
        <Route path={TEST_FLIGHT_PATH} element={<TestFlightRoute />} />
        <Route path="*" element={<Navigate to={VIEWER_PATH} replace />} />
      </Routes>
    </main>
  )
}
