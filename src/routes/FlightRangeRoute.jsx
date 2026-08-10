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
  captureMouseStick,
  centreMouseStick,
  clearMouseStick,
  moveMouseStick,
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
  // Whether the world currently holds the pointer. Real React state, not a ref: the prompt
  // that asks for the click and the HUD's own caption both change with it.
  const [pointerLocked, setPointerLocked] = useState(false)
  // Read once, on first render: the choice outlives the session, and the renderer is built
  // from it before anything is drawn.
  const [quality, setQuality] = useState(readFlightQuality)

  // Esc opens the menu and never closes it: closing belongs to the menu, which knows
  // whether a sub-pane is open. Reading the flag off a ref keeps `extraKeys` stable, so
  // the keyboard listener is not re-bound on every pause.
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const stage = useRef(null)
  const freeLooking = useRef(false)
  const dragLook = useRef({ id: null, x: 0, y: 0 })
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
    // A relative stick has no spring, so it needs one key that says "hands off". Without it
    // the only way back to level is to retrace the travel by eye, and a pilot who has lost
    // track of how much they are holding has no way to find neutral again.
    //
    // X rather than the obvious R: R is already the range reset, and `extraKeys` is spread
    // over the session's own actions, so binding it here would have taken the reset away
    // without saying so.
    const centre = (event, { fieldFocused }) => {
      if (pausedRef.current || fieldFocused || event.repeat) return
      event.preventDefault()
      centreMouseStick(controlsRef.current)
    }
    return { Escape: open, KeyP: open, KeyC: camera, KeyX: centre }
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

  // Resume is a click, which is the gesture a capture request needs — so the pilot who was
  // flying with the mouse goes straight back to flying with it. Without this, every Escape
  // costs two clicks: one to leave the menu and one to pick the aircraft back up.
  const resume = useCallback(() => {
    setPaused(false)
    if (mouseFlightEnabledRef.current) stage.current?.requestPointerLock?.()
  }, [])
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
    if (!value) {
      clearMouseStick(controls.current)
      if (document.pointerLockElement === stage.current) document.exitPointerLock?.()
    }
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
  The stage's own pointer, which only matters while the surface has *not* captured it.

  Left click hands the pointer over: nothing else on the page takes a click, so there is no
  gesture to compete with and the capture is a plain consequence of touching the sky. Right
  drag is free look, kept as a drag here because a pilot who has turned mouse flight off never
  reaches the captured path at all and would otherwise lose the camera with it.

  Once captured, both belong to the window listeners below and this handler stands aside.
  Touch is left alone throughout: the on-screen deck is its control surface.
  */
  const onStagePointerDown = useCallback((event) => {
    if (pausedRef.current || event.pointerType === 'touch') return
    if (document.pointerLockElement === stage.current) return

    if (event.button === 2) {
      event.preventDefault()
      dragLook.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
      // Deliberately not zeroed. The camera owns the return, and re-seeds these from the
      // angle actually on screen; zeroing them would snap a re-grab back to the chase pose.
      controls.current.cameraLook.active = true
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (event.button === 0 && mouseFlightEnabled) stage.current?.requestPointerLock?.()
  }, [controls, mouseFlightEnabled])

  const onStagePointerMove = useCallback((event) => {
    const drag = dragLook.current
    if (drag.id !== event.pointerId) return
    // Inverted on both axes: the drag carries the aircraft with the hand rather than
    // swinging the camera against it. The camera clamps the pitch it can actually use.
    const look = controls.current.cameraLook
    look.yaw -= (event.clientX - drag.x) * 0.006
    look.pitch = Math.max(-Math.PI, Math.min(Math.PI,
      look.pitch + ((event.clientY - drag.y) * 0.005),
    ))
    drag.x = event.clientX
    drag.y = event.clientY
  }, [controls])

  const onStagePointerUp = useCallback((event) => {
    if (dragLook.current.id !== event.pointerId) return
    dragLook.current.id = null
    controls.current.cameraLook.active = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [controls])

  /*
  The captured pointer, and the two things it does.

  Capture is what makes a relative stick work at all: with the pointer held by the surface
  there is no edge of the screen to reach, so a roll can be held for as long as the wrist
  keeps moving, and the arrow the pilot is not looking at cannot wander onto another window.

  Escape is the way out, and it is the browser's — every engine reserves it, and none of them
  deliver the keydown to the page. So losing the capture *is* the pause signal rather than
  something the pause handler has to notice separately; a sortie can never end up running with
  the pointer loose and nothing flying it.
  */
  useEffect(() => {
    const surface = stage.current
    if (!surface) return undefined

    const onLockChange = () => {
      const locked = document.pointerLockElement === surface
      setPointerLocked(locked)
      if (locked) {
        captureMouseStick(controls.current)
        dragLook.current.id = null
        return
      }
      clearMouseStick(controls.current)
      controls.current.cameraLook.active = false
      freeLooking.current = false
      // Both look paths let go, not just the captured one. Losing the lock mid-right-drag
      // would otherwise leave the drag's pointer id armed, and every later pointer move
      // would steer the camera with no button held.
      dragLook.current.id = null
      if (!pausedRef.current) setPaused(true)
    }

    // A refused capture is not a lost one. Chrome declines for about a second after the
    // pilot presses Escape, and treating that as a lock drop would bounce a too-eager
    // second click straight back into the menu it just came out of. Leave the prompt up.
    const onLockError = () => {
      setPointerLocked(document.pointerLockElement === surface)
    }

    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('pointerlockerror', onLockError)
    return () => {
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('pointerlockerror', onLockError)
    }
  }, [controls])

  useEffect(() => {
    if (!pointerLocked) return undefined

    const onMove = (event) => {
      if (pausedRef.current) return
      if (freeLooking.current) {
        // Inverted on both axes: the drag carries the aircraft with the hand rather than
        // swinging the camera against it. The camera clamps the pitch it can actually use.
        const look = controls.current.cameraLook
        look.yaw -= event.movementX * 0.006
        look.pitch = Math.max(-Math.PI, Math.min(Math.PI,
          look.pitch + (event.movementY * 0.005),
        ))
        return
      }
      // Travel, not position. `movementX/Y` is all a captured pointer reports, and it is all
      // this control ever wanted: the stick moves by the same amount the hand did.
      moveMouseStick(controls.current, event.movementX, event.movementY, {
        invertPitch: mousePitchInverted,
        sensitivity: mouseSensitivity,
      })
    }

    const onDown = (event) => {
      // Right button is camera only, exactly as the drag used to be. The stick keeps whatever
      // it is holding, so a turn already being flown carries on through the look.
      if (event.button !== 2 || pausedRef.current) return
      event.preventDefault()
      freeLooking.current = true
      // Deliberately not zeroed. The camera owns the return, and re-seeds these from the
      // angle actually on screen; zeroing them would snap a re-grab back to the chase pose.
      controls.current.cameraLook.active = true
    }

    const onUp = (event) => {
      if (event.button !== 2 || !freeLooking.current) return
      freeLooking.current = false
      controls.current.cameraLook.active = false
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
    }
  }, [controls, mousePitchInverted, mouseSensitivity, pointerLocked])

  // The menu needs a pointer to be operated with, so opening it always gives the pointer
  // back. Resuming does not take it again on its own: that has to be a click, both because
  // browsers require a gesture and because the pilot may have paused to reach the bezel.
  useEffect(() => {
    if (paused && document.pointerLockElement === stage.current) document.exitPointerLock?.()
  }, [paused])

  return (
    <section className="test-flight-surface" aria-label={`Test flight over ${map.name} ${map.region}`}>
      <div
        // The captured pointer is invisible by definition, and the HUD draws the stick gate
        // in its place. `cursor: none` covers the moment before the capture takes, so the
        // arrow does not flash across the sky on the way in.
        className={`flight-canvas-stage ${pointerLocked ? 'is-flying' : ''}`}
        ref={stage}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
        onPointerCancel={onStagePointerUp}
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
          pointerLocked={pointerLocked}
        />
      </div>

      {/* The one thing the pilot has to be told, shown only while it is true. A captured
          pointer is not a state a browser can enter on its own, and a sortie that silently
          ignored the mouse until someone happened to click would read as a broken control. */}
      {mouseFlightEnabled && !pointerLocked && !paused && (
        <p className="flight-capture-prompt" role="status">
          <span>Click the sky to fly with the mouse</span>
          <small>Esc releases the pointer and opens the menu</small>
        </p>
      )}

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
