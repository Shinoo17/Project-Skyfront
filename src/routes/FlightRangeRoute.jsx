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
import PauseMenu from '../features/flight-range/pause-menu'
import {
  centreMouseStick,
  clearMouseStick,
  engageMouseStick,
  moveMouseStick,
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
  readFlightCameraRoll,
  readFlightFov,
  writeFlightCameraDistance,
  writeFlightCameraRoll,
  writeFlightFov,
} from '../features/flight/chaseCamera'
import {
  assignBinding,
  clearBinding,
  defaultKeyBindings,
  readKeyBindings,
  toBindingMap,
  writeKeyBindings,
} from '../features/flight/keybindings'
import { readMasterVolume, writeMasterVolume } from '../features/flight-range/audio'
import {
  readAltitudeUnit,
  readSpeedUnit,
  writeAltitudeUnit,
  writeSpeedUnit,
} from '../features/flight-range/units'
import LoaderScreen from '../ui/LoaderScreen'
import SceneErrorBoundary from '../ui/SceneErrorBoundary'
import {
  readFlightCustomGraphics,
  readFlightQuality,
  writeFlightCustomGraphics,
  writeFlightQuality,
} from '../three/graphics'
import useFullscreen from '../ui/useFullscreen'
import { VIEWER_PATH } from './paths'

/*
Whether the browser can take the pointer at all. When it cannot — an iPad running the
desktop site is the realistic case — the stick falls back to the free pointer it used
before: live wherever the arrow is resting over the sky. Everything below reads this once
rather than feature-testing per event, because the answer cannot change mid-sortie.
*/
const POINTER_LOCK_SUPPORTED = typeof document !== 'undefined'
  && typeof document.exitPointerLock === 'function'

export default function FlightRangeRoute() {
  const handleFullscreen = useFullscreen()
  const navigate = useNavigate()
  const [paused, setPaused] = useState(false)
  const [cameraMode, setCameraMode] = useState('chase')
  const [cameraRoll, setCameraRoll] = useState(readFlightCameraRoll)
  const [cameraDistance, setCameraDistance] = useState(readFlightCameraDistance)
  const [cameraFov, setCameraFov] = useState(readFlightFov)
  const [speedUnit, setSpeedUnit] = useState(readSpeedUnit)
  const [altitudeUnit, setAltitudeUnit] = useState(readAltitudeUnit)
  const [keyBindings, setKeyBindings] = useState(readKeyBindings)
  const [customGraphics, setCustomGraphics] = useState(readFlightCustomGraphics)
  const [masterVolume, setMasterVolume] = useState(readMasterVolume)
  const [mouseFlightEnabled, setMouseFlightEnabled] = useState(readMouseFlightEnabled)
  const [mousePitchInverted, setMousePitchInverted] = useState(readMousePitchInverted)
  const [mouseSensitivity, setMouseSensitivity] = useState(readMouseSensitivity)
  // Whether the sky currently owns the pointer. Mirrored into a ref because the pointer
  // handlers are bound once and read it every move; the state exists for the HUD prompt.
  const [pointerLocked, setPointerLocked] = useState(false)
  const pointerLockedRef = useRef(false)
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
      // Written before the state, and before the lock is given back below. Losing the
      // pointer is itself a request to open this menu — see `onPointerLockChange` — and
      // that handler runs long before React re-renders the ref into agreement.
      pausedRef.current = true
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

  // Flattened once per rebind rather than per render: `useFlightControls` re-subscribes the
  // window whenever this identity changes, and a fresh object every render would tear down
  // and rebuild the keyboard listener sixty times a second.
  const bindingMap = useMemo(() => toBindingMap(keyBindings), [keyBindings])

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
  } = useFlightSession({ extraKeys, paused, bindings: bindingMap })
  controlsRef.current = controls.current

  const centreStick = useCallback(() => centreMouseStick(controls.current), [controls])
  const dropStick = useCallback(() => clearMouseStick(controls.current), [controls])

  /*
  Ask for the pointer. The request can be refused — Chrome throttles it for about a second
  after an Esc release, and a document that is not focused cannot have it at all — so the
  failure path has to be quiet and the locked flag must never be set here. `pointerlockchange`
  is the single source of truth for whether the sky actually has the pointer; anything else
  would let the HUD claim a lock the browser declined and leave the pilot with a free cursor
  over a screen that thinks it is flying.

  `unadjustedMovement` asks for raw device motion with the OS acceleration curve taken off,
  which is what makes a fixed hand movement mean a fixed deflection. Browsers that do not
  know the option reject the whole request, so a plain one is retried once behind it.
  */
  const requestPointerLock = useCallback(() => {
    const element = stage.current
    if (!POINTER_LOCK_SUPPORTED || !element?.requestPointerLock) return
    if (document.pointerLockElement === element) return
    // A pilot who has switched the mouse stick off is flying on the arrow keys and wants
    // their cursor. Taking it would leave them with a hidden pointer and nothing to do
    // with it.
    if (!mouseFlightEnabledRef.current) return

    // Plain, and last: whatever went wrong with the option, the pilot still asked to fly.
    const plain = () => {
      try {
        element.requestPointerLock()?.catch?.(() => {})
      } catch {
        // Refused outright. The pointer stays free and the prompt stays up, which is the
        // honest outcome and the one the pilot can act on.
      }
    }

    try {
      const request = element.requestPointerLock({ unadjustedMovement: true })
      if (request && typeof request.catch === 'function') request.catch(plain)
    } catch {
      plain()
    }
  }, [])

  // Resuming hands the pointer straight back, because the click that resumed is a gesture
  // the browser accepts and a pilot who chose Resume is asking to fly, not to click again.
  // It is only a request: if it lands inside the post-Esc throttle window the sortie resumes
  // with a free cursor and the prompt on the glass, and one click puts it back.
  const resume = useCallback(() => {
    centreStick()
    pausedRef.current = false
    setPaused(false)
    requestPointerLock()
  }, [centreStick, requestPointerLock])
  const exit = useCallback(() => navigate(VIEWER_PATH), [navigate])

  /*
  Every setting the menu can move, through one door.

  Each one is two things — the value this sortie flies with, and the value the next one
  starts from — and pairing them here is what keeps the menu from having to know about
  local storage at all. It hands back a name and a value; the module that owns that name
  does the remembering.

  Only the mouse stick has a side effect beyond that: switching it off has to let go of a
  stick that may be deflected, or the aircraft holds the last deflection for ever.
  */
  const changeSetting = useCallback((name, value) => {
    switch (name) {
      case 'quality':
        setQuality(value)
        writeFlightQuality(value)
        break
      case 'customGraphics':
        setCustomGraphics(value)
        writeFlightCustomGraphics(value)
        break
      case 'cameraRoll':
        setCameraRoll(value)
        writeFlightCameraRoll(value)
        break
      case 'cameraDistance':
        setCameraDistance(value)
        writeFlightCameraDistance(value)
        break
      case 'cameraFov':
        setCameraFov(value)
        writeFlightFov(value)
        break
      case 'speedUnit':
        setSpeedUnit(value)
        writeSpeedUnit(value)
        break
      case 'altitudeUnit':
        setAltitudeUnit(value)
        writeAltitudeUnit(value)
        break
      case 'keyBindings':
        setKeyBindings(value)
        writeKeyBindings(value)
        break
      case 'masterVolume':
        setMasterVolume(value)
        writeMasterVolume(value)
        break
      case 'mouseFlightEnabled':
        setMouseFlightEnabled(value)
        writeMouseFlightEnabled(value)
        if (!value) dropStick()
        break
      case 'mousePitchInverted':
        setMousePitchInverted(value)
        writeMousePitchInverted(value)
        break
      case 'mouseSensitivity':
        setMouseSensitivity(value)
        writeMouseSensitivity(value)
        break
      case 'debug':
        setDebug(value)
        break
      default:
        break
    }
  }, [dropStick, setDebug])

  // A rebind is a change to the whole map rather than to one key, because taking a code
  // means taking it away from whatever else was holding it. Both of these come back as a
  // new map and go out through the same door as everything else.
  const bindKey = useCallback((action, slot, code) => {
    changeSetting('keyBindings', assignBinding(keyBindings, action, slot, code))
  }, [changeSetting, keyBindings])

  const unbindKey = useCallback((action, slot) => {
    changeSetting('keyBindings', clearBinding(keyBindings, action, slot))
  }, [changeSetting, keyBindings])

  const resetKeyBindings = useCallback(() => {
    changeSetting('keyBindings', defaultKeyBindings())
  }, [changeSetting])

  /*
  The stage's pointer, and the three things it does.

  A left click hands the pointer to the sky. Until then the cursor is an ordinary cursor and
  the stick is not live at all: the sortie fills the window, and a stick that flew on hover
  would mean the pilot cannot reach a menu, a tab, or a second monitor without the aircraft
  answering the journey. Once locked the cursor is gone, the pointer cannot leave the canvas,
  and Esc gives it back — which is also what opens the pause menu.

  The stick stays positional through all of it, and only the way the position arrives changes:
  locked it is walked by raw motion inside the input layer, and on a browser that cannot take
  the pointer at all it is the cursor's own position over the glass, exactly as before. Both
  land in the same held position, so nothing downstream — the gate, the shaping, the
  telemetry — knows which one it is looking at.

  Right drag is free look, and while it is held the stick is centred rather than left where
  it was: the pointer is aiming the camera, so it is not saying anything about the stick, and
  a look that ended somewhere else entirely would otherwise hand the aircraft a deflection
  nobody chose.

  Touch is left alone throughout: the on-screen deck is its control surface.
  */
  const onStagePointerDown = useCallback((event) => {
    if (pausedRef.current || event.pointerType === 'touch') return

    if (event.button === 0) {
      if (!mouseFlightEnabledRef.current || pointerLockedRef.current) return
      event.preventDefault()
      requestPointerLock()
      return
    }

    if (event.button !== 2) return
    event.preventDefault()
    dragLook.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    // Deliberately not zeroed. The camera owns the return, and re-seeds these from the
    // angle actually on screen; zeroing them would snap a re-grab back to the chase pose.
    controls.current.cameraLook.active = true
    centreStick()
    // A locked pointer is already captured by the document, and capturing it again would be
    // a second path to reason about for no gain.
    if (!pointerLockedRef.current) event.currentTarget.setPointerCapture(event.pointerId)
  }, [centreStick, controls, requestPointerLock])

  const onStagePointerMove = useCallback((event) => {
    if (pausedRef.current || event.pointerType === 'touch') return
    // `clientX`/`clientY` stop moving the moment the pointer is locked. Every reader below
    // has to know which of the two worlds it is in, or it silently reads a frozen number.
    const locked = pointerLockedRef.current

    const drag = dragLook.current
    if (drag.id === event.pointerId) {
      // Inverted on both axes: the drag carries the aircraft with the hand rather than
      // swinging the camera against it. The camera clamps the pitch it can actually use.
      const look = controls.current.cameraLook
      const dx = locked ? (event.movementX || 0) : event.clientX - drag.x
      const dy = locked ? (event.movementY || 0) : event.clientY - drag.y
      look.yaw -= dx * 0.006
      look.pitch = Math.max(-Math.PI, Math.min(Math.PI, look.pitch + (dy * 0.005)))
      drag.x = event.clientX
      drag.y = event.clientY
      return
    }
    if (!mouseFlightEnabledRef.current || drag.id !== null) return
    // The pointer is loose over the sky on a browser that could have taken it. That is a
    // cursor on its way somewhere, not a stick, and the prompt on the glass says so.
    if (!locked && POINTER_LOCK_SUPPORTED) return

    const rect = event.currentTarget.getBoundingClientRect()
    const { invert, sensitivity } = mouseSettings.current
    const shaping = {
      extent: Math.min(rect.width, rect.height),
      invertPitch: invert,
      sensitivity,
    }

    // Motion when the sky holds the pointer, position when it does not. The input layer
    // keeps the held position either way, so both arrive downstream as the same stick.
    if (locked) {
      moveMouseStick(controls.current, event.movementX || 0, event.movementY || 0, shaping)
      return
    }
    setMouseStick(
      controls.current,
      event.clientX - rect.left - (rect.width / 2),
      event.clientY - rect.top - (rect.height / 2),
      shaping,
    )
  }, [controls])

  const onStagePointerUp = useCallback((event) => {
    if (dragLook.current.id !== event.pointerId) return
    dragLook.current.id = null
    controls.current.cameraLook.active = false
    // Neutral until the next pointer move says otherwise. The look may have finished a long
    // way from where it started, and the frame between the button coming up and the pointer
    // moving again must not be flown by the old position.
    centreStick()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [centreStick, controls])

  // Only reachable with the pointer free — a locked one cannot leave. It has gone to the
  // bezel, another window, or the edge of the screen, and nothing out there is a stick
  // position, so the aircraft stops being asked for anything rather than holding the
  // deflection the pointer had as it crossed the edge.
  const onStagePointerLeave = useCallback((event) => {
    if (event.pointerType === 'touch' || pointerLockedRef.current) return
    dropStick()
  }, [dropStick])

  /*
  The pointer changing hands, in both directions and from every cause.

  Losing it *is* the pause request. Esc is the obvious one and the important one: the browser
  eats that keystroke to release the lock and never dispatches it to the page, so the menu
  cannot be opened from the keyboard handler while the sky holds the pointer. Reading the
  release instead catches the rest of the same family for free — a tab switch, a window the
  compositor took away — and each of them is equally a pilot who is no longer flying.

  It also closes the gap the `extraKeys` comment describes: in fullscreen Esc goes to leaving
  fullscreen and the page never sees it, but the lock is dropped along with it, so the menu
  still opens.
  */
  useEffect(() => {
    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === stage.current
      const wasLocked = pointerLockedRef.current
      pointerLockedRef.current = locked
      setPointerLocked(locked)

      if (locked) {
        // The lock starts at the middle of the gate whatever the cursor was hovering when
        // the click landed. Engaging must not be a control input.
        engageMouseStick(controls.current)
        return
      }

      dropStick()
      // Only a lock that was actually held is a pilot who has stopped flying. A request that
      // was refused never had the pointer, and answering that with a menu would make Resume
      // bounce straight back to the menu whenever it landed inside the browser's cooldown.
      if (!wasLocked || pausedRef.current) return
      pausedRef.current = true
      setPaused(true)
    }

    // A refused request is not a release: the pointer stays where it was, the prompt stays
    // up, and one more click is all it costs. Only the flag has to come back into line.
    const onPointerLockError = () => {
      pointerLockedRef.current = false
      setPointerLocked(false)
    }

    document.addEventListener('pointerlockchange', onPointerLockChange)
    document.addEventListener('pointerlockerror', onPointerLockError)
    return () => {
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      document.removeEventListener('pointerlockerror', onPointerLockError)
      // Leaving the range must never leave the pointer behind in it.
      if (document.pointerLockElement) document.exitPointerLock()
    }
  }, [controls, dropStick])

  // Opening the menu gives the pointer back and drops the stick: the cursor is about to be
  // used on buttons, and every move across them would otherwise be flown. Resume asks for
  // the pointer again.
  useEffect(() => {
    if (!paused) return
    dropStick()
    if (document.pointerLockElement) document.exitPointerLock()
  }, [dropStick, paused])

  // Two ways the mouse can be flying the aircraft, and the difference is only whether the
  // browser could take the pointer. Everything the pilot sees keys off the answer, not off
  // the setting: the setting says the mouse is allowed to fly, this says it is.
  const stickLive = mouseFlightEnabled && (pointerLocked || !POINTER_LOCK_SUPPORTED)
  const showEngagePrompt = mouseFlightEnabled && POINTER_LOCK_SUPPORTED && !pointerLocked && !paused

  // One object rather than sixteen props. The menu reads it; only `changeSetting` writes.
  const settings = useMemo(() => ({
    quality,
    customGraphics,
    cameraRoll,
    cameraDistance,
    cameraFov,
    speedUnit,
    altitudeUnit,
    keyBindings,
    masterVolume,
    mouseFlightEnabled,
    mousePitchInverted,
    mouseSensitivity,
    debug,
  }), [
    quality,
    customGraphics,
    cameraRoll,
    cameraDistance,
    cameraFov,
    speedUnit,
    altitudeUnit,
    keyBindings,
    masterVolume,
    mouseFlightEnabled,
    mousePitchInverted,
    mouseSensitivity,
    debug,
  ])

  return (
    <section className="test-flight-surface" aria-label={`Test flight over ${map.name} ${map.region}`}>
      <div
        // A crosshair only once the sky has the pointer, or on a browser that cannot take it
        // and therefore still flies from the cursor's own position. Before that the cursor is
        // an ordinary cursor with an ordinary job, and dressing it as a reticle would promise
        // a control that is not connected yet.
        className={`flight-canvas-stage ${stickLive && !paused ? 'is-flying' : ''}`}
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
            cameraRoll={cameraRoll}
            cameraDistance={cameraDistance}
            cameraFov={cameraFov}
            customGraphics={customGraphics}
          />
        </SceneErrorBoundary>
      </div>

      <div className="flight-vignette" aria-hidden="true" />
      <div className="flight-interface">
        {/* The one piece of chrome the sortie shows while flying, and only while the stick is
            disconnected. It is announced politely rather than asserted, because it appears
            every time the menu closes and a pilot who already knows is not being told news. */}
        {showEngagePrompt && (
          <p className="flight-engage-prompt" role="status">
            <span>Click to fly</span>
            <small>the mouse takes the stick · Esc releases it</small>
          </p>
        )}
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
          mouseStickLive={stickLive}
          speedUnit={speedUnit}
          altitudeUnit={altitudeUnit}
          keyBindings={keyBindings}
        />
      </div>

      <PauseMenu
        open={paused}
        aircraft={aircraft}
        map={map}
        telemetry={telemetry}
        settings={settings}
        onChange={changeSetting}
        onBindKey={bindKey}
        onUnbindKey={unbindKey}
        onResetKeyBindings={resetKeyBindings}
        onResume={resume}
        onExit={exit}
        onFullscreen={handleFullscreen}
      />

      <LoaderScreen mode="flight" map={map} />
    </section>
  )
}
