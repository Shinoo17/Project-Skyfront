/*
THESIS: One plate of lit glass drawn through the flight camera itself, and one dark cockpit bezel holding the controls — two materials instead of eleven grey boxes.
OWN-WORLD: Ice-blue symbology burned onto the canopy, its ladder registered with the real horizon, with carbon control wells clamped to the frame edges.
STORY: The pilot reads attitude off the terrain-locked ladder, checks energy on the flanking tapes, watches ground clearance, and steers from the bezel.
FIRST VIEWPORT: Terrain and aircraft fill the frame; scrolling speed and altitude tapes flank a pitch ladder that banks with the world; every stroke stays readable against sky and rock alike.
FORM: A real fighter HUD — projected ladder and flight path marker, scrolling tapes, and advisories that only ever name state the simulation actually has.
*/

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronsDown,
  Camera,
  Eye,
  Flame,
  Gauge,
  Minus,
  Orbit,
  Plus,
  RotateCcw,
  RotateCw,
  TriangleAlert,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { createFlightHud } from './hud'
import { EMPTY_TELEMETRY } from '../flight/telemetry'

const RESET_CAPTIONS = {
  ceiling: 'CEILING · RANGE RESET',
  manual: 'RANGE RESET',
  range: 'RANGE EDGE · RESET',
  terrain: 'TERRAIN · RANGE RESET',
}

// The detector's regimes, named the way a pilot would call them. Only the ones worth an
// advisory line. The immediate stall warning is rendered independently at the centre of
// the glass, so it cannot be displaced by a lower-priority advisory.
const MANEUVER_CAPTIONS = {
  tumble: 'TUMBLE',
  cobra: 'COBRA',
  'j-turn': 'J-TURN',
  'pedal-turn': 'PEDAL TURN',
  tailslide: 'TAILSLIDE',
  'falling-leaf': 'FALLING LEAF',
  'flat-turn': 'FLAT ROTATION',
  'post-stall': 'POST-STALL',
  recovery: 'RECOVERING',
}

// A retina backing store for a canvas that repaints every frame is the difference between
// crisp symbology and a soft one; past 2x it is pixels nobody can see.
const MAX_PIXEL_RATIO = 2

/*
The advisory and the independent stall latch are the only HUD states that belong in React:
they change a handful of times per sortie and must be announced to screen readers.
Everything continuous is drawn to the canvas or written straight to the DOM. Advisories
are ordered most urgent first.
*/
function readAdvisory(telemetry) {
  if (!telemetry.live) return { key: 'standby', label: 'RANGE STANDBY', tone: 'normal' }
  if (telemetry.sinceReset < 2.6 && telemetry.resetCause) {
    return {
      key: `reset-${telemetry.resetCause}`,
      label: RESET_CAPTIONS[telemetry.resetCause] ?? 'RANGE RESET',
      tone: 'alert',
    }
  }
  if (telemetry.groundClearance < 120) return { key: 'pull-up', label: 'PULL UP', tone: 'alert' }
  if (telemetry.edge < 260) return { key: 'edge-hard', label: 'RANGE EDGE · TURN BACK', tone: 'alert' }
  if (telemetry.edge < 620) return { key: 'edge-soft', label: 'APPROACHING RANGE EDGE', tone: 'caution' }
  if (telemetry.groundClearance < 260) return { key: 'terrain', label: 'TERRAIN', tone: 'caution' }
  if (telemetry.ceiling < 120) return { key: 'ceiling', label: 'CEILING', tone: 'caution' }
  // A burner state, not a burner number: the reserve and its clock live on the glass and
  // the bezel, where they can change every frame without costing a render. This one only
  // latches and unlatches, so it is cheap here and worth announcing.
  if (telemetry.afterburnerState === 'depleted') {
    return { key: 'reheat-out', label: 'REHEAT DEPLETED · COOLING', tone: 'caution' }
  }
  if (telemetry.psmPhase === 'high-aoa') {
    return { key: 'psm-ready', label: 'PSM READY · PULL UP', tone: 'caution' }
  }
  if (telemetry.psmPhase === 'recovery') {
    return { key: 'psm-recovery', label: 'PSM RECOVERY', tone: 'caution' }
  }
  if (telemetry.psmPhase === 'cobra-hold') {
    return { key: 'psm-cobra', label: 'COBRA HOLD · ↓ RECOVER · ↑ CONTINUE', tone: 'caution' }
  }
  if (telemetry.psmPhase === 'post-stall-flip') {
    return { key: 'psm-flip', label: 'FLIP · RELEASE TO HOLD · ↓ RECOVER', tone: 'caution' }
  }
  if (telemetry.psmPhase === 'post-stall-reversal') {
    return { key: 'psm-reversal', label: 'PSM REVERSAL · ADD POWER', tone: 'caution' }
  }
  if (telemetry.psmPhase === 'post-stall') {
    return { key: 'psm-active', label: 'PSM · RELEASE TO HOLD · ↑ FLIP', tone: 'caution' }
  }
  // A named manoeuvre outranks housekeeping advisories: the detector reads the physics,
  // and calling the regime is the cheapest feedback the range can give.
  const maneuver = MANEUVER_CAPTIONS[telemetry.maneuver]
  if (maneuver) return { key: `mnv-${telemetry.maneuver}`, label: maneuver, tone: 'caution' }
  // The max-performance turn, named while it is being flown. It ranks below the manoeuvre
  // captions because it cannot happen at the same time as any of them, and says the one
  // consequence the pilot needs now: MIL power cannot refund the turn's energy bill.
  if (telemetry.highGBlend > 0.5) {
    return { key: 'high-g', label: 'HIGH-G TURN · SPEED BLEED', tone: 'caution' }
  }
  // The airbrake is independent and may remain active during this or any other regime.
  if (telemetry.airBrake) {
    return { key: 'airbrake', label: 'AIRBRAKE · HEAVY DECEL', tone: 'caution' }
  }
  if (telemetry.flaps) return { key: 'flaps', label: 'FLAPS DOWN', tone: 'caution' }
  return { key: 'clear', label: 'FLIGHT PATH CLEAR', tone: 'normal' }
}

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value
}

function HoldControl({ control, label, icon: Icon, controls, className, nodeRef, children }) {
  const release = useCallback(() => {
    controls.current.pressed.delete(control)
  }, [control, controls])

  return (
    <button
      type="button"
      className={className ? `deck-key ${className}` : 'deck-key'}
      ref={nodeRef}
      aria-label={label}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        controls.current.pressed.add(control)
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
          event.preventDefault()
          controls.current.pressed.add(control)
        }
      }}
      onKeyUp={(event) => {
        if (event.key === 'Enter' || event.key === ' ') release()
      }}
      onBlur={release}
    >
      <Icon size={18} strokeWidth={1.8} />
      <span>{children}</span>
    </button>
  )
}

function FreeLookControl({ controls }) {
  const pointer = useRef({ id: null, x: 0, y: 0 })

  const release = useCallback((event) => {
    if (pointer.current.id !== event.pointerId) return
    pointer.current.id = null
    controls.current.cameraLook.active = false
  }, [controls])

  return (
    <button
      type="button"
      className="deck-key"
      aria-label="Drag to free look around aircraft"
      onPointerDown={(event) => {
        event.preventDefault()
        pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
        // Not zeroed: the camera owns the return and re-seeds these from the angle on
        // screen, so resetting them here would snap a re-grab back to the chase pose.
        controls.current.cameraLook.active = true
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (pointer.current.id !== event.pointerId) return
        // Same inverted sense as the canvas drag, at twice the gain: the deck key is a
        // thumb-sized surface, so the same wrist travel has far fewer pixels to spend.
        const look = controls.current.cameraLook
        look.yaw -= (event.clientX - pointer.current.x) * 0.012
        look.pitch = Math.max(-Math.PI, Math.min(Math.PI,
          look.pitch + ((event.clientY - pointer.current.y) * 0.01),
        ))
        pointer.current.x = event.clientX
        pointer.current.y = event.clientY
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <Eye size={18} strokeWidth={1.8} />
      <span>Free look</span>
    </button>
  )
}

// The debug readout as one preformatted block: a dozen numbers that change every frame
// belong in a single text write, not a dozen DOM nodes.
function formatDebug(value) {
  if (!value.live) return 'FLIGHT DEBUG\nstandby'
  const row = (label, text) => `${label.padEnd(9)}${text}`
  const trend = value.acceleration > 5 ? '↑' : value.acceleration < -5 ? '↓' : '→'
  return [
    'FLIGHT DEBUG',
    row('SPD', `${value.speed.toFixed(0)} km/h ${trend} ${value.acceleration.toFixed(1)} km/h/s`
      + `  M${value.mach.toFixed(2)}`),
    row('FWD', `${value.forwardSpeed.toFixed(0)} km/h  ${value.flightRegime}`),
    row('ENGINE', `cmd ${value.commandedThrottle.toFixed(2)}  actual ${value.engineThrottle.toFixed(2)}`),
    row('FORCE', `T ${value.thrust.toFixed(1)}  D ${value.totalDrag.toFixed(1)} km/h/s`),
    row('DRAG', `P ${value.parasiteDrag.toFixed(1)}  I ${value.inducedDrag.toFixed(1)}`
      + `  B ${value.airbrakeDrag.toFixed(1)}`),
    row('BRAKE', `${Math.round(value.airbrakeAmount * 100)}%`),
    row('ALT', `${value.altitude.toFixed(0)}  V/S ${value.verticalSpeed.toFixed(1)}`),
    row('AOA', `${value.aoa.toFixed(1)}°  SLIP ${value.sideslip.toFixed(1)}°`),
    row('G', `${value.currentG.toFixed(2)}${value.extremeManeuverActive ? '  EXTREME' : ''}`),
    row('RATE', `P${value.pitchRate.toFixed(0)} R${value.rollRate.toFixed(0)} Y${value.yawRate.toFixed(0)} °/s`),
    row('A/B', value.afterburnerState),
    row('TVC', `${value.thrustVector.toFixed(1)}°`),
    row('STALL', `${Math.round(value.postStallBlend * 100)}%${value.airBrake ? ' +brake' : ''}`),
    row('HI-G', `${Math.round(value.highGBlend * 100)}%`),
    row('PSM', `${value.psmPhase} ${Math.round(value.psmBlend * 100)}%`
      + ` float ${Math.round(value.psmFloatBlend * 100)}% g×${value.gravityScale.toFixed(2)}`),
    row('DEPART', `${Math.round(value.departureBlend * 100)}%`),
    row('MNVR', value.maneuver),
    row('FPS', String(value.fps || 0)),
  ].join('\n')
}

/*
`variant` picks how much of the cockpit comes with the glass. 'cockpit' is the sortie: the
projected symbology plus the bezel the pilot flies from. 'glass' is the same symbology and
nothing else, for the observer page's picture-in-picture, where the box is a few hundred
pixels wide and the controls belong to the page around it rather than inside the inset.
Both draw from the same telemetry through the same camera, so the inset is a true copy of
what the pilot is looking at, not a reconstruction of it.
*/
export default function FlightHud({
  controls,
  telemetry,
  envelope,
  onReset,
  cameraMode = 'chase',
  onToggleCameraMode,
  debug = false,
  variant = 'cockpit',
  mouseFlightEnabled = true,
  mousePitchInverted = false,
  // Whether the mouse currently has the stick, which is not the same question as whether it
  // is allowed to: on a browser with Pointer Lock the pilot has to click the sky first.
  mouseStickLive = true,
}) {
  const glassOnly = variant === 'glass'
  const dom = useRef({})
  const [advisory, setAdvisory] = useState(() => readAdvisory(EMPTY_TELEMETRY))
  const advisoryKey = useRef(advisory.key)
  const [stallWarning, setStallWarning] = useState(false)
  const stallWarningActive = useRef(false)

  // The glass is one canvas the size of the WebGL view, so a point projected through the
  // flight camera lands on the same pixel in both. It is sized from the HUD's own box
  // rather than the window, so entering fullscreen re-registers it without a reload.
  useEffect(() => {
    const canvas = dom.current.glass
    const frame = dom.current.root
    if (!canvas || !frame) return undefined

    const hud = createFlightHud(canvas, { combatBand: envelope.combatBandKmh ?? null })

    // The ratio is read per resize, not once: browser zoom and a drag onto a display of a
    // different density both fire the observer, and a backing store left at the old ratio
    // is soft symbology until the next remount.
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      hud.resize(width, height, Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
    })
    observer.observe(frame)

    let request = 0
    const paint = () => {
      request = window.requestAnimationFrame(paint)
      const value = telemetry.current

      const next = readAdvisory(value)
      if (next.key !== advisoryKey.current) {
        advisoryKey.current = next.key
        setAdvisory(next)
      }

      const nextStallWarning = Boolean(value.live && value.postStallActive)
      if (nextStallWarning !== stallWarningActive.current) {
        stallWarningActive.current = nextStallWarning
        setStallWarning(nextStallWarning)
      }

      hud.draw(value)

      // The bezel is DOM: it changes slowly, it holds text a screen reader can reach, and
      // none of it sits on the sightline.
      const nodes = dom.current
      setText(nodes.fps, value.live && value.fps ? String(value.fps) : '–')
      setText(nodes.speed, value.live ? String(Math.round(value.speed)) : '–')
      setText(nodes.mach, value.live ? value.mach.toFixed(2) : '–')
      setText(nodes.afterburnerState, value.afterburnerState === 'depleted'
        ? `cooling down, ${value.afterburnerCooldown.toFixed(1)} seconds`
        : value.afterburnerState)
      setText(nodes.afterburnerReserve, value.live
        ? value.afterburnerSeconds.toFixed(1)
        : '–')
      // The reserve rides on the key itself, so the pilot's thumb and their eye are on the
      // same control while the burner drains.
      if (nodes.afterburner) {
        nodes.afterburner.style.setProperty('--reserve', String(value.afterburnerReserve))
        nodes.afterburner.classList.toggle('is-active', value.afterburner)
        nodes.afterburner.classList.toggle('is-depleted', value.afterburnerState === 'depleted')
      }
      const powerIntent = value.extremeManeuverActive
        ? 'EXTREME · HOLD'
        : value.afterburnerActive
          ? 'AFTERBURNER'
          : value.commandedThrottle >= 0.99
            ? 'MIL POWER'
            : value.commandedThrottle <= 0.01
              ? 'IDLE'
              : 'AUTO ASSIST'
      setText(nodes.powerIntent, value.live ? powerIntent : '–')
      if (nodes.debug) setText(nodes.debug, formatDebug(value))
    }

    request = window.requestAnimationFrame(paint)
    return () => {
      window.cancelAnimationFrame(request)
      observer.disconnect()
    }
  }, [telemetry, envelope])

  return (
    <div
      className={`hud ${glassOnly ? 'is-glass' : ''}`}
      aria-label={glassOnly ? 'Pilot view instruments' : 'Flight instruments'}
      ref={(node) => { dom.current.root = node }}
    >
      {/* Projected symbology — one plate of lit glass, drawn through the flight camera. */}
      <canvas className="hud-glass" aria-hidden="true" ref={(node) => { dom.current.glass = node }} />

      <dl className="hud-a11y-readout">
        <div><dt>Speed</dt><dd><output ref={(node) => { dom.current.speed = node }}>–</output> km/h</dd></div>
        <div><dt>Mach</dt><dd><output ref={(node) => { dom.current.mach = node }}>–</output></dd></div>
        <div><dt>Afterburner</dt><dd ref={(node) => { dom.current.afterburnerState = node }}>off</dd></div>
        <div>
          <dt>Afterburner remaining</dt>
          <dd><output ref={(node) => { dom.current.afterburnerReserve = node }}>–</output> seconds</dd>
        </div>
      </dl>

      {!glassOnly && (
        <div className="fps-readout flight-fps" aria-label="WebGL rendering performance">
          <span>FPS</span>
          <output ref={(node) => { dom.current.fps = node }}>–</output>
        </div>
      )}

      {!glassOnly && debug && (
        <pre className="hud-debug" aria-label="Flight model debug readout" ref={(node) => { dom.current.debug = node }}>
          FLIGHT DEBUG
        </pre>
      )}

      <p className={`hud-advisory is-${advisory.tone}`} role="status">
        {advisory.tone === 'alert' && <TriangleAlert size={15} strokeWidth={2.2} aria-hidden="true" />}
        <span>{advisory.label}</span>
      </p>

      {stallWarning && (
        <p className="hud-stall-warning" role="alert">
          <TriangleAlert size={22} strokeWidth={2.4} aria-hidden="true" />
          <span>STALL</span>
        </p>
      )}

      {!glassOnly && <div className="deck deck-controls" aria-label="Flight controls">
        <div className="deck-stick">
          <span aria-hidden="true" />
          <HoldControl control="pitch-up" label="Pitch up" icon={ArrowUp} controls={controls}>Nose up</HoldControl>
          <span aria-hidden="true" />
          <HoldControl control="roll-left" label="Roll left" icon={ArrowLeft} controls={controls}>Roll L</HoldControl>
          <button type="button" className="deck-key is-reset" onClick={onReset} aria-label="Reset flight">
            <RotateCcw size={17} strokeWidth={1.8} />
            <span>Reset</span>
          </button>
          <HoldControl control="roll-right" label="Roll right" icon={ArrowRight} controls={controls}>Roll R</HoldControl>
          <span aria-hidden="true" />
          <HoldControl control="pitch-down" label="Pitch down" icon={ArrowDown} controls={controls}>Nose dn</HoldControl>
          <span aria-hidden="true" />
        </div>

        <div className="deck-engine">
          <div className="deck-row">
            <HoldControl control="yaw-left" label="Yaw left" icon={RotateCcw} controls={controls}>Yaw L</HoldControl>
            <HoldControl control="yaw-right" label="Yaw right" icon={RotateCw} controls={controls}>Yaw R</HoldControl>
            <HoldControl control="flaps" label="Deploy flaps" icon={ChevronsDown} controls={controls}>Flaps</HoldControl>
            <HoldControl
              control="afterburner"
              label="Hold for afterburner"
              icon={Flame}
              controls={controls}
              className="is-afterburner"
              nodeRef={(node) => { dom.current.afterburner = node }}
            >
              A/B
            </HoldControl>
          </div>

          <div className="deck-row is-modes">
            <HoldControl
              control="air-brake"
              label="Hold to deploy the airbrake"
              icon={Orbit}
              controls={controls}
            >
              BRK
            </HoldControl>
            <HoldControl
              control="maneuver-assist"
              label="Hold for maneuver assist"
              icon={Zap}
              controls={controls}
            >
              MNV
            </HoldControl>
            <button
              type="button"
              className={`deck-key ${cameraMode === 'nose' ? 'is-selected' : ''}`}
              aria-label={`Switch to ${cameraMode === 'chase' ? 'nose' : 'chase'} camera`}
              aria-pressed={cameraMode === 'nose'}
              onClick={onToggleCameraMode}
            >
              <Camera size={18} strokeWidth={1.8} />
              <span>{cameraMode === 'chase' ? 'Chase' : 'Nose'}</span>
            </button>
            <FreeLookControl controls={controls} />
            <HoldControl control="rear-view" label="Hold for rear view" icon={Eye} controls={controls}>
              Rear
            </HoldControl>
          </div>

          <div className="deck-throttle">
            <div className="deck-throttle-head">
              <span><Gauge size={14} strokeWidth={1.9} /> POWER INTENT</span>
              <span className="deck-command-speed">
                <b ref={(node) => { dom.current.powerIntent = node }}>–</b>
              </span>
            </div>
            <div className="deck-throttle-row">
              <HoldControl control="throttle-down" label="Request idle power" icon={Minus} controls={controls}>
                Slow
              </HoldControl>
              <span className="deck-power-hint"><kbd>W</kbd> + <kbd>S</kbd> EXTREME</span>
              <HoldControl control="throttle-up" label="Request military power" icon={Plus} controls={controls}>
                Fast
              </HoldControl>
            </div>
          </div>
        </div>
      </div>}

      {!glassOnly && <p className="deck-keymap">
        <kbd>MOUSE</kbd>
        <span>
          {mouseFlightEnabled && mouseStickLive
            && `aim to roll / pitch${mousePitchInverted ? ' · inverted' : ''} · centre is neutral · right-hold view`}
          {mouseFlightEnabled && !mouseStickLive && 'click the sky to take the stick'}
          {!mouseFlightEnabled && 'flight control off'}
        </span>
        <kbd>↑</kbd><kbd>↓</kbd><span>pitch</span>
        <kbd>A</kbd><kbd>D</kbd><span>roll</span>
        <kbd>Q</kbd><kbd>E</kbd><span>yaw</span>
        <kbd>W</kbd><kbd>S</kbd><span>MIL power / idle</span>
        <kbd>W+S</kbd><span>extreme maneuver</span>
        <kbd>SHIFT</kbd><span>afterburner</span>
        <kbd>SPACE</kbd><span>airbrake</span>
        <kbd>ALT</kbd><kbd>↑</kbd><span>maneuver</span>
        <kbd>C</kbd><kbd>ESC</kbd><span>camera · release &amp; menu</span>
      </p>}
    </div>
  )
}
