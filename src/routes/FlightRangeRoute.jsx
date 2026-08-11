/*
THESIS: The range is the aircraft, the map, and one HUD — this route only wires them together.
OWN-WORLD: Full-bleed canvas under a projected instrument layer; no chrome of its own, not even a top bar.
STORY: The pilot launches, flies, and resets without the route ever standing between them and the sky; Esc stops the world.
FIRST VIEWPORT: Terrain and aircraft fill the canvas; the HUD owns everything drawn over it.
FORM: Composition only — flight state lives in a ref the scene writes and the HUD reads.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import FlightHud from '../features/flight-range/FlightHud'
import FlightRangeScene from '../features/flight-range/FlightRangeScene'
import PauseMenu from '../features/flight-range/PauseMenu'
import {
  centreMouseStick,
  clearMouseStick,
  setMouseStick,
  readMouseFlightEnabled,
  readMousePitchInverted,
  readMouseSensitivity,
  writeMouseFlightEnabled,
  writeMousePitchInverted,
  writeMouseSensitivity,
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

export default function FlightRangeRoute() {
  const handleFullscreen = useFullscreen()
  const navigate = useNavigate()
  const [paused, setPaused] = useState(false)
  const [cameraMode, setCameraMode] = useState('chase')
  const [cameraStyle, setCameraStyle] = useState(readFlightCameraStyle)
  const [cameraDistance, setCameraDistance] = useState(readFlightCameraDistance)
  const [mouseFlightEnabled, setMouseFlightEnabled] = useState(readMouseFlightEnabled)
  const [mousePitchInverted, setMousePitchInverted] = useState(readMousePitchInverted)
  const [mouseSensitivity, setMouseSensitivity] = useState(readMouseSensitivity)
  // Read once, on first render: the choice outlives the session, and the renderer is built
  // from it before anything is drawn.
  const [quality, setQuality] = useState(readFlightQuality)

  // Esc opens the menu and never closes it: closing belongs to the menu, which knows
  // whether a sub-pane is open. Reading the flag off a ref keeps `extraKeys` stable, so
  // the keyboard listener is not re-bound on every pause.
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const stage = useRef(null)
  const dragLook = useRef({ id: null, x: 0, y: 0 })
  // The live values the stage's pointer handler needs. It is bound once as a JSX prop, and
  // reading the settings off a ref keeps it from being rebuilt every time a slider moves.
  const mouseSettings = useRef({ invert: mousePitchInverted, sensitivity: mouseSensitivity })
  mouseSettings.current.invert = mousePitchInverted
  mouseSettings.current.sensitivity = mouseSensitivity
  // The flight input state, reachable from `extraKeys` — which has to be built before the
  // session that owns it exists, and must stay stable so the keyboard is not re-bound.
  const controlsRef = useRef(null)
  const mouseFlightEnabledRef = useRef(mouseFlightEnabled)
  mouseFlightEnabledRef.current = mouseFlightEnabled

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
    // No centre key. The stick is the pointer's position now, so neutral is the middle of
    // the screen and a key that set it would be overwritten by the very next pointer move.
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
  controlsRef.current = controls.current

  // Nothing to hand back: the pointer was never taken. Resuming clears whatever deflection
  // the stick was holding when the menu opened, so the aircraft is not flown by a pointer
  // that has spent the pause sitting over a button.
  const resume = useCallback(() => {
    centreMouseStick(controls.current)
    setPaused(false)
  }, [controls])
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

  const chooseMouseFlightEnabled = useCallback((value) => {
    setMouseFlightEnabled(value)
    writeMouseFlightEnabled(value)
    if (!value) clearMouseStick(controls.current)
  }, [controls])

  const chooseMousePitchInverted = useCallback((value) => {
    setMousePitchInverted(value)
    writeMousePitchInverted(value)
  }, [])

  const chooseMouseSensitivity = useCallback((value) => {
    setMouseSensitivity(value)
    writeMouseSensitivity(value)
  }, [])

  /*
  The stage's pointer, and the two things it does.

  The stick is a position, so the pointer is never captured: `clientX`/`clientY` against the
  middle of the surface is the whole control, and the pilot can see the arrow that is holding
  it. Right drag is free look, and while it is held the stick is centred rather than left
  where it was — the pointer is being used to aim the camera, so it is not saying anything
  about the stick, and a look that ended with the pointer somewhere else entirely would
  otherwise hand the aircraft a deflection nobody chose.

  Touch is left alone throughout: the on-screen deck is its control surface.
  */
  const onStagePointerDown = useCallback((event) => {
    if (pausedRef.current || event.pointerType === 'touch') return
    if (event.button !== 2) return
    event.preventDefault()
    dragLook.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    // Deliberately not zeroed. The camera owns the return, and re-seeds these from the
    // angle actually on screen; zeroing them would snap a re-grab back to the chase pose.
    controls.current.cameraLook.active = true
    centreMouseStick(controls.current)
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [controls])

  const onStagePointerMove = useCallback((event) => {
    if (pausedRef.current || event.pointerType === 'touch') return

    const drag = dragLook.current
    if (drag.id === event.pointerId) {
      // Inverted on both axes: the drag carries the aircraft with the hand rather than
      // swinging the camera against it. The camera clamps the pitch it can actually use.
      const look = controls.current.cameraLook
      look.yaw -= (event.clientX - drag.x) * 0.006
      look.pitch = Math.max(-Math.PI, Math.min(Math.PI,
        look.pitch + ((event.clientY - drag.y) * 0.005),
      ))
      drag.x = event.clientX
      drag.y = event.clientY
      return
    }
    if (!mouseFlightEnabledRef.current || drag.id !== null) return

    // Position, not travel: where the pointer sits inside the gate is where the stick sits.
    const rect = event.currentTarget.getBoundingClientRect()
    const { invert, sensitivity } = mouseSettings.current
    setMouseStick(
      controls.current,
      event.clientX - rect.left - (rect.width / 2),
      event.clientY - rect.top - (rect.height / 2),
      { extent: Math.min(rect.width, rect.height), invertPitch: invert, sensitivity },
    )
  }, [controls])

  const onStagePointerUp = useCallback((event) => {
    if (dragLook.current.id !== event.pointerId) return
    dragLook.current.id = null
    controls.current.cameraLook.active = false
    // Neutral until the next pointer move says otherwise. The look may have finished a long
    // way from where it started, and the frame between the button coming up and the pointer
    // moving again must not be flown by the old position.
    centreMouseStick(controls.current)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [controls])

  // The pointer has left the sky — for the bezel, another window, or the edge of the screen.
  // Nothing out there is a stick position, so the aircraft stops being asked for anything
  // rather than holding the deflection the pointer had as it crossed the edge.
  const onStagePointerLeave = useCallback((event) => {
    if (event.pointerType === 'touch') return
    clearMouseStick(controls.current)
  }, [controls])

  // Opening the menu drops the stick: the pointer is about to be used on buttons, and every
  // move across them would otherwise be flown. It comes back live on the first move over the
  // sky after the menu closes.
  useEffect(() => {
    if (paused) clearMouseStick(controls.current)
  }, [controls, paused])

  return (
    <section className="test-flight-surface" aria-label={`Test flight over ${map.name} ${map.region}`}>
      <div
        // The pointer is the stick, so it stays visible and becomes a crosshair over the sky:
        // its position on the glass is the deflection, and hiding it would throw away the
        // readout the whole control is built on. The HUD's gate is the shaped half of the
        // same story — how much of that position the aircraft is actually being given.
        className={`flight-canvas-stage ${mouseFlightEnabled && !paused ? 'is-flying' : ''}`}
        ref={stage}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
        onPointerCancel={onStagePointerUp}
        onPointerLeave={onStagePointerLeave}
        onLostPointerCapture={onStagePointerUp}
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
          mouseFlightEnabled={mouseFlightEnabled}
          mousePitchInverted={mousePitchInverted}
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
        mouseFlightEnabled={mouseFlightEnabled}
        onChooseMouseFlightEnabled={chooseMouseFlightEnabled}
        mousePitchInverted={mousePitchInverted}
        onChooseMousePitchInverted={chooseMousePitchInverted}
        mouseSensitivity={mouseSensitivity}
        onChooseMouseSensitivity={chooseMouseSensitivity}
      />

      <LoaderScreen mode="flight" map={map} />
    </section>
  )
}
