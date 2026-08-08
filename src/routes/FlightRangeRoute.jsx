/*
THESIS: The range is the aircraft, the map, and one HUD — this route only wires them together.
OWN-WORLD: Full-bleed canvas under a projected instrument layer; no chrome of its own, not even a top bar.
STORY: The pilot launches, flies, and resets without the route ever standing between them and the sky; Esc stops the world.
FIRST VIEWPORT: Terrain and aircraft fill the canvas; the HUD owns everything drawn over it.
FORM: Composition only — flight state lives in a ref the scene writes and the HUD reads.
*/

import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import FlightHud from '../features/flight-range/FlightHud'
import FlightRangeScene from '../features/flight-range/FlightRangeScene'
import PauseMenu from '../features/flight-range/PauseMenu'
import useFlightSession from '../features/flight/useFlightSession'
import LoaderScreen from '../ui/LoaderScreen'
import SceneErrorBoundary from '../ui/SceneErrorBoundary'
import { readFlightQuality, writeFlightQuality } from '../three/graphics'
import useFullscreen from '../ui/useFullscreen'
import { VIEWER_PATH } from './paths'

export default function FlightRangeRoute() {
  const handleFullscreen = useFullscreen()
  const navigate = useNavigate()
  const [paused, setPaused] = useState(false)
  // Read once, on first render: the choice outlives the session, and the renderer is built
  // from it before anything is drawn.
  const [quality, setQuality] = useState(readFlightQuality)

  // Esc opens the menu and never closes it: closing belongs to the menu, which knows
  // whether a sub-pane is open. Reading the flag off a ref keeps `extraKeys` stable, so
  // the keyboard listener is not re-bound on every pause.
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  const extraKeys = useMemo(() => {
    // P opens the same menu as Esc: in fullscreen the browser keeps Esc to leave fullscreen
    // and never dispatches it, and a pilot who cannot reach the menu cannot leave the range.
    const open = (event) => {
      if (pausedRef.current) return
      event.preventDefault()
      setPaused(true)
    }
    return { Escape: open, KeyP: open }
  }, [])

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
  } = useFlightSession({ extraKeys, paused })

  const resume = useCallback(() => setPaused(false), [])
  const exit = useCallback(() => navigate(VIEWER_PATH), [navigate])
  const toggleDebug = useCallback(() => setDebug((value) => !value), [setDebug])
  const chooseQuality = useCallback((value) => {
    setQuality(value)
    writeFlightQuality(value)
  }, [])

  return (
    <section className="test-flight-surface" aria-label={`Test flight over ${map.name} ${map.region}`}>
      <div className="flight-canvas-stage">
        <SceneErrorBoundary>
          <FlightRangeScene
            aircraftId={aircraft.id}
            mapId={map.id}
            controls={controls}
            resetId={resetId}
            telemetry={telemetry}
            debug={debug}
            paused={paused}
            quality={quality}
          />
        </SceneErrorBoundary>
      </div>

      <div className="flight-vignette" aria-hidden="true" />
      <div className="flight-interface">
        <FlightHud
          controls={controls}
          telemetry={telemetry}
          envelope={envelope}
          onReset={reset}
          debug={debug}
        />
      </div>

      <PauseMenu
        open={paused}
        onResume={resume}
        onExit={exit}
        onFullscreen={handleFullscreen}
        debug={debug}
        onToggleDebug={toggleDebug}
        quality={quality}
        onChooseQuality={chooseQuality}
      />

      <LoaderScreen mode="flight" map={map} />
    </section>
  )
}
