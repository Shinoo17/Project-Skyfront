/*
THESIS: The range is the aircraft, the terrain, and one HUD — this route only wires them together.
OWN-WORLD: Full-bleed canvas under a projected instrument layer; no chrome of its own.
STORY: The pilot launches, flies, and resets without the route ever standing between them and the sky.
FIRST VIEWPORT: Terrain and aircraft fill the canvas; the HUD owns everything drawn over it.
FORM: Composition only — flight state lives in a ref the scene writes and the HUD reads.
*/

import { useCallback, useMemo, useRef, useState } from 'react'

import { getAircraft } from '../aircraft'
import useFlightControls from '../features/flight/useFlightControls'
import FlightHud from '../features/test-flight/FlightHud'
import TestFlightScene from '../features/test-flight/TestFlightScene'
import { createTelemetry } from '../features/test-flight/telemetry'
import LoaderScreen from '../ui/LoaderScreen'
import SceneErrorBoundary from '../ui/SceneErrorBoundary'
import Topbar from '../ui/Topbar'
import useFullscreen from '../ui/useFullscreen'

export default function TestFlightRoute() {
  const handleFullscreen = useFullscreen()
  const aircraft = getAircraft()
  const envelope = aircraft.flight.envelope
  const [resetId, setResetId] = useState(0)

  // One object, mutated in place by the flight loop and read by the HUD's own animation
  // frame. Flight state never becomes React state, so a 60 Hz range renders React zero
  // times a second.
  const telemetry = useRef(createTelemetry())

  const reset = useCallback(() => setResetId((value) => value + 1), [])

  const keyActions = useMemo(() => ({
    KeyR: (event) => {
      event.preventDefault()
      setResetId((value) => value + 1)
    },
  }), [])

  const controls = useFlightControls({ throttle: envelope.idleThrottle, keyActions })

  return (
    <section className="test-flight-surface" aria-label="Test flight over Mountain Valley Colorado">
      <div className="flight-canvas-stage">
        <SceneErrorBoundary>
          <TestFlightScene
            aircraftId={aircraft.id}
            controls={controls}
            resetId={resetId}
            telemetry={telemetry}
          />
        </SceneErrorBoundary>
      </div>

      <div className="flight-vignette" aria-hidden="true" />
      <div className="flight-interface">
        <Topbar onFullscreen={handleFullscreen} />
        <FlightHud
          controls={controls}
          telemetry={telemetry}
          envelope={envelope}
          onReset={reset}
        />
      </div>

      <LoaderScreen mode="test-flight" />
    </section>
  )
}
