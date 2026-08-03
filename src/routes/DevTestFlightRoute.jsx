/*
THESIS: Watch the jet the way another player would, with the pilot's own view pinned in the corner for comparison.
OWN-WORLD: A static observer post over the range; the aircraft crosses the frame instead of the frame chasing it.
STORY: The developer flies from the keyboard, drags the observer to any angle, and reads the same instant twice — outside and inside.
FIRST VIEWPORT: The valley under a free-orbit camera, telemetry down the left edge, the pilot's HUD inset bottom-right.
FORM: Composition only — one scene, one physics step, two cameras rendered in the same frame.
*/

import { useCallback, useState } from 'react'

import { DEFAULT_AIRCRAFT_ID } from '../aircraft'
import DevFlightPanel from '../features/dev-flight/DevFlightPanel'
import DevFlightScene from '../features/dev-flight/DevFlightScene'
import FlightHud from '../features/flight-range/FlightHud'
import useFlightSession from '../features/flight/useFlightSession'
import { DEFAULT_MAP_ID } from '../maps'
import LoaderScreen from '../ui/LoaderScreen'
import SceneErrorBoundary from '../ui/SceneErrorBoundary'
import Topbar from '../ui/Topbar'
import useFullscreen from '../ui/useFullscreen'

export default function DevTestFlightRoute() {
  const handleFullscreen = useFullscreen()
  const [mapId, setMapId] = useState(DEFAULT_MAP_ID)
  const [aircraftId, setAircraftId] = useState(DEFAULT_AIRCRAFT_ID)
  const [pip, setPip] = useState(true)
  const [pilotHud, setPilotHud] = useState(true)
  const [recenterId, setRecenterId] = useState(0)

  // Where the picture-in-picture ended up, in CSS pixels, reported by the renderer that
  // scissored it. The HUD overlay is positioned from the same numbers rather than from a
  // second CSS rule, because symbology that is a few pixels off the WebGL box stops being
  // registered with the terrain it is drawn over.
  const [pipRect, setPipRect] = useState(null)

  const {
    aircraft,
    map,
    envelope,
    controls,
    telemetry,
    resetId,
    reset,
    debug,
    setDebug,
  } = useFlightSession({ mapId, aircraftId })

  const recenter = useCallback(() => setRecenterId((value) => value + 1), [])

  return (
    <section className="test-flight-surface" aria-label={`Developer test flight over ${map.name} ${map.region}`}>
      <div className="flight-canvas-stage">
        <SceneErrorBoundary>
          <DevFlightScene
            key={`${map.id}:${aircraft.id}`}
            aircraftId={aircraft.id}
            mapId={map.id}
            controls={controls}
            resetId={resetId}
            telemetry={telemetry}
            debug={debug}
            pip={pip}
            recenterId={recenterId}
            onPipRect={setPipRect}
          />
        </SceneErrorBoundary>
      </div>

      <div className="flight-interface">
        <Topbar onFullscreen={handleFullscreen} kicker="TEST FLIGHT · DEV OBSERVER" />

        <DevFlightPanel
          telemetry={telemetry}
          mapId={mapId}
          onMapChange={setMapId}
          aircraftId={aircraftId}
          onAircraftChange={setAircraftId}
          pip={pip}
          onPipChange={setPip}
          pilotHud={pilotHud}
          onPilotHudChange={setPilotHud}
          debug={debug}
          onDebugChange={setDebug}
          onReset={reset}
          onRecenter={recenter}
        />

        {pipRect && (
          <div
            className="pip-frame"
            style={{
              left: `${pipRect.x}px`,
              top: `${pipRect.y}px`,
              width: `${pipRect.width}px`,
              height: `${pipRect.height}px`,
            }}
          >
            {pilotHud && (
              <FlightHud
                variant="glass"
                controls={controls}
                telemetry={telemetry}
                envelope={envelope}
                onReset={reset}
              />
            )}
            <span className="pip-label">PILOT VIEW</span>
          </div>
        )}
      </div>

      <LoaderScreen mode="flight" map={map} />
    </section>
  )
}
