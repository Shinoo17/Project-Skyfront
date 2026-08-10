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
import {
  clearAnalogFlightInput,
  readMouseFlightAxes,
  setAnalogFlightInput,
} from '../features/flight/flightInput'
import useFlightSession from '../features/flight/useFlightSession'
import {
  readFlightCameraDistance,
  readFlightCameraStyle,
  writeFlightCameraDistance,
  writeFlightCameraStyle,
} from '../features/flight/chaseCamera'
import LoaderScreen from '../ui/LoaderScreen'
import SceneErrorBoundary from '../ui/SceneErrorBoundary'
import { readFlightQuality, writeFlightQuality } from '../three/graphics'
import useFullscreen from '../ui/useFullscreen'
import { VIEWER_PATH } from './paths'

const MOUSE_STICK_SOURCE = 'mouse-stick'

export default function FlightRangeRoute() {
  const handleFullscreen = useFullscreen()
  const navigate = useNavigate()
  const [paused, setPaused] = useState(false)
  const [cameraMode, setCameraMode] = useState('chase')
  const [cameraStyle, setCameraStyle] = useState(readFlightCameraStyle)
  const [cameraDistance, setCameraDistance] = useState(readFlightCameraDistance)
  // Read once, on first render: the choice outlives the session, and the renderer is built
  // from it before anything is drawn.
  const [quality, setQuality] = useState(readFlightQuality)

  // Esc opens the menu and never closes it: closing belongs to the menu, which knows
  // whether a sub-pane is open. Reading the flag off a ref keeps `extraKeys` stable, so
  // the keyboard listener is not re-bound on every pause.
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const freeLookPointer = useRef({ id: null, x: 0, y: 0 })

  const toggleCameraMode = useCallback(() => {
    setCameraMode((value) => (value === 'chase' ? 'nose' : 'chase'))
  }, [])

  const extraKeys = useMemo(() => {
    // P opens the same menu as Esc: in fullscreen the browser keeps Esc to leave fullscreen
    // and never dispatches it, and a pilot who cannot reach the menu cannot leave the range.
    const open = (event) => {
      if (pausedRef.current) return
      event.preventDefault()
      setPaused(true)
    }
    const camera = (event, { fieldFocused }) => {
      if (pausedRef.current || fieldFocused || event.repeat) return
      event.preventDefault()
      toggleCameraMode()
    }
    return { Escape: open, KeyP: open, KeyC: camera }
  }, [toggleCameraMode])

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
  const chooseCameraStyle = useCallback((value) => {
    setCameraStyle(value)
    writeFlightCameraStyle(value)
  }, [])
  const chooseCameraDistance = useCallback((value) => {
    setCameraDistance(value)
    writeFlightCameraDistance(value)
  }, [])

  const clearMouseFlightControl = useCallback(() => {
    clearAnalogFlightInput(controls.current, MOUSE_STICK_SOURCE)
  }, [controls])

  const moveMouseFlightControl = useCallback((event) => {
    // Touch owns the on-screen deck. A mouse over the world is an absolute virtual stick:
    // where it sits relative to the centre is the command, so stopping the hand keeps the
    // chosen deflection instead of silently centring the aircraft.
    if (pausedRef.current
      || event.pointerType === 'touch'
      || freeLookPointer.current.id !== null) return
    setAnalogFlightInput(
      controls.current,
      MOUSE_STICK_SOURCE,
      readMouseFlightAxes(
        event.clientX,
        event.clientY,
        event.currentTarget.getBoundingClientRect(),
      ),
    )
  }, [controls])

  const beginFreeLook = useCallback((event) => {
    // Right drag is deliberately camera-only. Ordinary pointer movement flies pitch and
    // roll, while left click remains available to weapons without changing either system.
    if (pausedRef.current || event.button !== 2) return
    event.preventDefault()
    freeLookPointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    clearAnalogFlightInput(controls.current, MOUSE_STICK_SOURCE)
    // Deliberately not zeroed here. The camera owns the return, and re-seeds these from the
    // angle actually on screen; zeroing them would snap a re-grab back to the chase pose.
    controls.current.cameraLook.active = true
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [controls])

  const movePointer = useCallback((event) => {
    const pointer = freeLookPointer.current
    if (pointer.id !== event.pointerId) {
      moveMouseFlightControl(event)
      return
    }
    // Inverted on both axes: the drag carries the aircraft with the hand rather than
    // swinging the camera against it. The camera clamps the pitch it can actually use.
    const look = controls.current.cameraLook
    look.yaw -= (event.clientX - pointer.x) * 0.006
    look.pitch = Math.max(-Math.PI, Math.min(Math.PI,
      look.pitch + ((event.clientY - pointer.y) * 0.005),
    ))
    pointer.x = event.clientX
    pointer.y = event.clientY
  }, [controls, moveMouseFlightControl])

  const endFreeLook = useCallback((event) => {
    if (freeLookPointer.current.id !== event.pointerId) return
    freeLookPointer.current.id = null
    controls.current.cameraLook.active = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [controls])

  return (
    <section className="test-flight-surface" aria-label={`Test flight over ${map.name} ${map.region}`}>
      <div
        className="flight-canvas-stage"
        onPointerDown={beginFreeLook}
        onPointerMove={movePointer}
        onPointerUp={endFreeLook}
        onPointerCancel={endFreeLook}
        onLostPointerCapture={endFreeLook}
        onPointerLeave={clearMouseFlightControl}
        onContextMenu={(event) => event.preventDefault()}
      >
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
            cameraMode={cameraMode}
            cameraStyle={cameraStyle}
            cameraDistance={cameraDistance}
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
          cameraMode={cameraMode}
          onToggleCameraMode={toggleCameraMode}
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
        cameraStyle={cameraStyle}
        onChooseCameraStyle={chooseCameraStyle}
        cameraDistance={cameraDistance}
        onChooseCameraDistance={chooseCameraDistance}
      />

      <LoaderScreen mode="flight" map={map} />
    </section>
  )
}
