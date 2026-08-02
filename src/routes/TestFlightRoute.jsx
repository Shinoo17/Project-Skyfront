/*
THESIS: The test cell opens into a real mountain range without becoming a game dashboard.
OWN-WORLD: Carbon flight controls, fog-white telemetry, ice-blue live input, and one amber reset signal.
STORY: The pilot enters the range, reads only essential state, flies, and can recover instantly.
FIRST VIEWPORT: Terrain and aircraft fill the canvas; telemetry brackets the top while controls sit at the lower corners.
FORM: Radar Test Cell extended into an unobstructed chase-camera flight range.
*/

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Gauge,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getAircraft } from '../aircraft'
import TestFlightScene from '../features/test-flight/TestFlightScene'
import LoaderScreen from '../ui/LoaderScreen'
import SceneErrorBoundary from '../ui/SceneErrorBoundary'
import Topbar from '../ui/Topbar'
import useFullscreen from '../ui/useFullscreen'

const KEY_BINDINGS = {
  ArrowUp: 'pitch-up',
  ArrowDown: 'pitch-down',
  ArrowLeft: 'roll-left',
  ArrowRight: 'roll-right',
  KeyQ: 'yaw-left',
  KeyE: 'yaw-right',
  KeyW: 'throttle-up',
  KeyS: 'throttle-down',
  KeyF: 'flaps',
}

function HoldControl({ control, label, icon: Icon, controls, children }) {
  const release = useCallback(() => {
    controls.current.pressed.delete(control)
  }, [control, controls])

  return (
    <button
      type="button"
      className="range-control-button"
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
      <Icon size={17} strokeWidth={1.7} />
      <span>{children}</span>
    </button>
  )
}

export default function TestFlightRoute() {
  const handleFullscreen = useFullscreen()
  const aircraft = getAircraft()
  const { idleThrottle, minThrottle } = aircraft.flight.envelope
  const controls = useRef({ pressed: new Set(), throttle: idleThrottle })
  const [resetId, setResetId] = useState(0)
  const [telemetry, setTelemetry] = useState({
    altitude: 0,
    heading: 0,
    speed: 0,
    throttle: idleThrottle,
  })

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return

      const control = KEY_BINDINGS[event.code]
      if (control) {
        event.preventDefault()
        controls.current.pressed.add(control)
        return
      }

      if (event.code === 'KeyR') {
        event.preventDefault()
        setResetId((value) => value + 1)
      }
    }

    const onKeyUp = (event) => {
      const control = KEY_BINDINGS[event.code]
      if (!control) return
      event.preventDefault()
      controls.current.pressed.delete(control)
    }

    const releaseControls = () => controls.current.pressed.clear()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', releaseControls)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', releaseControls)
    }
  }, [])

  const handleTelemetry = useCallback((nextTelemetry) => {
    setTelemetry(nextTelemetry)
  }, [])

  const setThrottle = (value) => {
    controls.current.throttle = Number(value)
    setTelemetry((current) => ({
      ...current,
      throttle: controls.current.throttle,
    }))
  }

  return (
    <section className="test-flight-surface" aria-label="Test flight over Mountain Valley Colorado">
      <div className="flight-canvas-stage">
        <SceneErrorBoundary>
          <TestFlightScene
            aircraftId={aircraft.id}
            controls={controls}
            resetId={resetId}
            onTelemetry={handleTelemetry}
          />
        </SceneErrorBoundary>
      </div>

      <div className="flight-vignette" aria-hidden="true" />
      <div className="flight-interface">
        <Topbar onFullscreen={handleFullscreen} />

        <div className="flight-telemetry" aria-live="polite">
          <span>HDG <strong>{String(Math.round(telemetry.heading)).padStart(3, '0')}°</strong></span>
          <span>ALT <strong>{Math.round(telemetry.altitude)}</strong></span>
          <span>SPD <strong>{Math.round(telemetry.speed)}</strong></span>
          <span>THR <strong>{Math.round(telemetry.throttle * 100)}%</strong></span>
        </div>

        <div className="range-label" aria-hidden="true">
          <span>TEST RANGE / COLORADO</span>
          <strong>MOUNTAIN VALLEY</strong>
          <small>ARCADE FLIGHT MODEL · ECO RENDER 30 FPS</small>
        </div>

        <div className="flight-reticle" aria-hidden="true"><i /><i /></div>

        <div className="range-controls" aria-label="Flight controls">
          <div className="range-stick">
            <span aria-hidden="true" />
            <HoldControl control="pitch-up" label="Pitch up" icon={ArrowUp} controls={controls}>Pitch</HoldControl>
            <span aria-hidden="true" />
            <HoldControl control="roll-left" label="Roll left" icon={ArrowLeft} controls={controls}>Roll</HoldControl>
            <button
              type="button"
              className="range-reset-button"
              onClick={() => setResetId((value) => value + 1)}
              aria-label="Reset flight"
            >
              <RotateCcw size={16} />
              <span>Reset</span>
            </button>
            <HoldControl control="roll-right" label="Roll right" icon={ArrowRight} controls={controls}>Roll</HoldControl>
            <span aria-hidden="true" />
            <HoldControl control="pitch-down" label="Pitch down" icon={ArrowDown} controls={controls}>Pitch</HoldControl>
            <span aria-hidden="true" />
          </div>

          <div className="range-engine">
            <div className="range-yaw">
              <HoldControl control="yaw-left" label="Yaw left" icon={RotateCcw} controls={controls}>Yaw L</HoldControl>
              <HoldControl control="yaw-right" label="Yaw right" icon={RotateCw} controls={controls}>Yaw R</HoldControl>
            </div>
            <div className="range-throttle" style={{ '--range-throttle': telemetry.throttle }}>
              <div>
                <span><Gauge size={13} /> THROTTLE</span>
                <output>{Math.round(telemetry.throttle * 100)}%</output>
              </div>
              <div className="range-throttle-row">
                <HoldControl control="throttle-down" label="Reduce throttle" icon={Minus} controls={controls}>S</HoldControl>
                <input
                  type="range"
                  min={minThrottle}
                  max="1"
                  step="0.01"
                  value={telemetry.throttle}
                  aria-label="Flight throttle"
                  onChange={(event) => setThrottle(event.target.value)}
                />
                <HoldControl control="throttle-up" label="Increase throttle" icon={Plus} controls={controls}>W</HoldControl>
              </div>
            </div>
          </div>
        </div>

        <p className="range-keymap">
          ARROWS PITCH / ROLL <i /> Q E YAW <i /> W S THROTTLE <i /> F FLAPS <i /> R RESET
        </p>
      </div>

      <LoaderScreen mode="test-flight" />
    </section>
  )
}
