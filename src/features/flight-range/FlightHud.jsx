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
  Flame,
  Gauge,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  TriangleAlert,
  Wind,
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
// advisory line. Normal flight is not one, and neither is a stall on its own: the AoA
// envelope is continuous, so there is no mode change to announce.
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
The advisory is the one piece of HUD state that belongs in React: it changes a handful of
times per sortie, it swaps a colour and an icon, and it is announced to screen readers.
Everything continuous is drawn to the canvas or written straight to the DOM. Ordered most
urgent first.
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
  // A named manoeuvre outranks housekeeping advisories: the detector reads the physics,
  // and calling the regime is the cheapest feedback the range can give.
  const maneuver = MANEUVER_CAPTIONS[telemetry.maneuver]
  if (maneuver) return { key: `mnv-${telemetry.maneuver}`, label: maneuver, tone: 'caution' }
  if (telemetry.flaps) return { key: 'flaps', label: 'FLAPS DOWN', tone: 'caution' }
  // There is no assist mode left to announce — `postStallActive` now says only that the
  // wing is past its stalling angle. The regime captions above catch nearly every case
  // that reaches here; this is the stall warning for the rest.
  if (telemetry.postStallActive) {
    return { key: 'stall', label: 'STALL', tone: 'caution' }
  }
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

// The debug readout as one preformatted block: a dozen numbers that change every frame
// belong in a single text write, not a dozen DOM nodes.
function formatDebug(value) {
  if (!value.live) return 'FLIGHT DEBUG\nstandby'
  const row = (label, text) => `${label.padEnd(9)}${text}`
  return [
    'FLIGHT DEBUG',
    row('SPD', `${value.speed.toFixed(0)} km/h  M${value.mach.toFixed(2)}`),
    row('FWD', `${value.forwardSpeed.toFixed(0)} km/h  ${value.flightRegime}`),
    row('ALT', `${value.altitude.toFixed(0)}  V/S ${value.verticalSpeed.toFixed(1)}`),
    row('AOA', `${value.aoa.toFixed(1)}°  SLIP ${value.sideslip.toFixed(1)}°`),
    row('G', value.gLoad.toFixed(2)),
    row('RATE', `P${value.pitchRate.toFixed(0)} R${value.rollRate.toFixed(0)} Y${value.yawRate.toFixed(0)} °/s`),
    row('THR', `${Math.round(value.throttle * 100)}%  A/B ${value.afterburnerState}`),
    row('TVC', `${value.thrustVector.toFixed(1)}°`),
    row('STALL', `${Math.round(value.postStallBlend * 100)}%${value.airBrake ? ' +brake' : ''}`),
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
  debug = false,
  variant = 'cockpit',
}) {
  const glassOnly = variant === 'glass'
  const dom = useRef({})
  const [advisory, setAdvisory] = useState(() => readAdvisory(EMPTY_TELEMETRY))
  const advisoryKey = useRef(advisory.key)

  // The glass is one canvas the size of the WebGL view, so a point projected through the
  // flight camera lands on the same pixel in both. It is sized from the HUD's own box
  // rather than the window, so entering fullscreen re-registers it without a reload.
  useEffect(() => {
    const canvas = dom.current.glass
    const frame = dom.current.root
    if (!canvas || !frame) return undefined

    const hud = createFlightHud(canvas)

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
      if (nodes.throttleFill) {
        nodes.throttleFill.style.setProperty('--thrust', String(value.throttle))
        nodes.throttleFill.classList.toggle('is-afterburner', value.afterburner)
      }
      // The reserve rides on the key itself, so the pilot's thumb and their eye are on the
      // same control while the burner drains.
      if (nodes.afterburner) {
        nodes.afterburner.style.setProperty('--reserve', String(value.afterburnerReserve))
        nodes.afterburner.classList.toggle('is-active', value.afterburner)
        nodes.afterburner.classList.toggle('is-depleted', value.afterburnerState === 'depleted')
      }
      if (nodes.slider && document.activeElement !== nodes.slider) {
        const rounded = Math.round(value.throttle * 100) / 100
        if (Number(nodes.slider.value) !== rounded) nodes.slider.value = String(rounded)
      }
      if (nodes.debug) setText(nodes.debug, formatDebug(value))
    }

    request = window.requestAnimationFrame(paint)
    return () => {
      window.cancelAnimationFrame(request)
      observer.disconnect()
    }
  }, [telemetry])

  useEffect(() => {
    const slider = dom.current.slider
    if (!slider) return undefined

    const setThrottle = (event) => {
      controls.current.throttle = Number(event.currentTarget.value)
    }
    slider.addEventListener('input', setThrottle)
    return () => slider.removeEventListener('input', setThrottle)
  }, [controls])

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
            <HoldControl control="air-brake" label="Hold for air brake" icon={Wind} controls={controls}>
              Brake
            </HoldControl>
            <span className="deck-auto-mode" aria-label="Angle of attack assistance is automatic">
              AUTO AoA
            </span>
          </div>

          <div className="deck-throttle">
            <div className="deck-throttle-head">
              <span><Gauge size={14} strokeWidth={1.9} /> THROTTLE</span>
              <div className="deck-thrust" ref={(node) => { dom.current.throttleFill = node }} aria-hidden="true">
                <i />
              </div>
            </div>
            <div className="deck-throttle-row">
              <HoldControl control="throttle-down" label="Reduce throttle" icon={Minus} controls={controls}>S</HoldControl>
              <input
                type="range"
                min={envelope.minThrottle}
                max="1"
                step="0.01"
                defaultValue={envelope.idleThrottle}
                ref={(node) => { dom.current.slider = node }}
                aria-label="Flight throttle"
              />
              <HoldControl control="throttle-up" label="Increase throttle" icon={Plus} controls={controls}>W</HoldControl>
            </div>
          </div>
        </div>
      </div>}

      {!glassOnly && <p className="deck-keymap">
        <kbd>↑</kbd><kbd>↓</kbd><span>pitch</span>
        <kbd>←</kbd><kbd>→</kbd><span>roll</span>
        <kbd>Q</kbd><kbd>E</kbd><span>yaw</span>
        <kbd>W</kbd><kbd>S</kbd><span>throttle</span>
        <kbd>SHIFT</kbd><span>hold for afterburner</span>
        <kbd>SPACE</kbd><span>air brake</span>
        <span>AoA assist automatic</span>
        <kbd>F</kbd><span>flaps</span>
        <kbd>R</kbd><span>reset</span>
        <kbd>I</kbd><span>debug</span>
        <kbd>ESC</kbd><kbd>P</kbd><span>menu</span>
      </p>}
    </div>
  )
}
