/*
THESIS: A mission-ready hangar screen that keeps the aircraft larger than the game interface around it.
OWN-WORLD: Carbon black, cold vector lines, ice-blue live data, and amber configuration signals.
STORY: The player inspects the Raptor, checks its systems, controls the airframe, then enters the flight range.
FIRST VIEWPORT: Full-bleed 3D aircraft, a compact game-status rail, and controls fixed to the right edge.
FORM: Aerospace hangar terminal extended with a restrained combat-game HUD.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import useFlightControls, { readAxes, readThrottleDirection } from '../features/flight/useFlightControls'
import Interface from '../features/viewer/Interface'
import Scene from '../features/viewer/Scene'
import LoaderScreen from '../ui/LoaderScreen'
import SceneErrorBoundary from '../ui/SceneErrorBoundary'
import useFullscreen from '../ui/useFullscreen'

export default function ViewerRoute() {
  const [clips, setClips] = useState([])
  const [animationStates, setAnimationStates] = useState({})
  const [isPlaying, setIsPlaying] = useState(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [autoRotate, setAutoRotate] = useState(false)
  const [lightingMode, setLightingMode] = useState('studio')
  const [viewRequest, setViewRequest] = useState({ view: 'perspective', id: 0 })
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [manualFlight, setManualFlight] = useState(false)
  const [aircraftMotionEnabled, setAircraftMotionEnabled] = useState(true)
  const [flightInput, setFlightInput] = useState({
    pitch: 0,
    roll: 0,
    yaw: 0,
    flaps: 0,
  })
  const [throttle, setThrottle] = useState(0.32)
  const [afterburner, setAfterburner] = useState(false)
  const [flightResetId, setFlightResetId] = useState(0)
  const manualFlightRef = useRef(manualFlight)
  manualFlightRef.current = manualFlight
  const handleFullscreen = useFullscreen()

  const handleClipsReady = useCallback((nextClips) => {
    setClips(nextClips)
  }, [])

  const handleAnimationToggle = useCallback((systemId) => {
    setManualFlight(false)
    setAfterburner(false)
    setFlightInput({ pitch: 0, roll: 0, yaw: 0, flaps: 0 })
    setAnimationStates((current) => ({
      ...current,
      [systemId]: !current[systemId],
    }))
    setIsPlaying(true)
  }, [])

  const handleViewChange = useCallback((view) => {
    setViewRequest({ view, id: performance.now() })
    setIsPanelOpen(false)
  }, [])

  const handleManualFlightChange = useCallback((enabled) => {
    setManualFlight(enabled)
    setFlightInput({ pitch: 0, roll: 0, yaw: 0, flaps: 0 })
    setAutoRotate(false)
    setIsPlaying(!enabled)
    if (!enabled) setAfterburner(false)
  }, [])

  const handleFlightInput = useCallback((axis, value) => {
    setManualFlight(true)
    setAutoRotate(false)
    setIsPlaying(false)
    setFlightInput((current) => (
      current[axis] === value ? current : { ...current, [axis]: value }
    ))
  }, [])

  const handleFlightReset = useCallback(() => {
    setManualFlight(true)
    setFlightInput({ pitch: 0, roll: 0, yaw: 0, flaps: 0 })
    setFlightResetId((value) => value + 1)
  }, [])

  const handleThrottleChange = useCallback((value) => {
    const nextThrottle = Math.min(1, Math.max(0, value))
    setManualFlight(true)
    setAutoRotate(false)
    setIsPlaying(false)
    setThrottle(nextThrottle)
    if (nextThrottle < 0.65) setAfterburner(false)
  }, [])

  const handleAfterburnerToggle = useCallback(() => {
    setManualFlight(true)
    setAutoRotate(false)
    setIsPlaying(false)
    setAfterburner((enabled) => {
      if (!enabled) setThrottle((value) => Math.max(value, 0.72))
      return !enabled
    })
  }, [])

  const keyActions = useMemo(() => ({
    Space: (event, { fieldFocused }) => {
      // Space still activates whatever control has focus rather than dropping flight mode.
      const target = event.target instanceof HTMLElement ? event.target : null
      if (fieldFocused || target?.closest('button')) return
      event.preventDefault()
      if (manualFlightRef.current) {
        setManualFlight(false)
        setAfterburner(false)
        setFlightInput({ pitch: 0, roll: 0, yaw: 0, flaps: 0 })
        setIsPlaying(true)
      } else {
        setIsPlaying((value) => !value)
      }
    },
    KeyR: (event, { fieldFocused }) => {
      if (fieldFocused) return
      handleViewChange('perspective')
    },
  }), [handleViewChange])

  const flightControls = useFlightControls({
    // Any flight key drops the viewer out of clip playback and into direct control.
    onPress: () => {
      setManualFlight(true)
      setAutoRotate(false)
      setIsPlaying(false)
    },
    onChange: (pressed) => setFlightInput(readAxes(pressed)),
    keyActions,
  })

  // Held W/S ramp the throttle rather than setting it, so this reads the keys on a
  // timer instead of on the keydown.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const direction = readThrottleDirection(flightControls.current.pressed)
      if (!direction) return

      setThrottle((value) => {
        const nextThrottle = Math.min(1, Math.max(0, value + (direction * 0.025)))
        if (nextThrottle < 0.65) setAfterburner(false)
        return nextThrottle
      })
    }, 50)

    return () => window.clearInterval(timer)
  }, [flightControls])

  return (
    <>
      <div
        className="canvas-stage"
        onDoubleClick={() => handleViewChange('perspective')}
      >
        <SceneErrorBoundary>
          <Scene
            animationStates={animationStates}
            isPlaying={isPlaying}
            playbackSpeed={playbackSpeed}
            autoRotate={autoRotate}
            viewRequest={viewRequest}
            lightingMode={lightingMode}
            manualFlight={manualFlight}
            aircraftMotionEnabled={aircraftMotionEnabled}
            flightInput={flightInput}
            flightResetId={flightResetId}
            throttle={throttle}
            afterburner={afterburner}
            onClipsReady={handleClipsReady}
          />
        </SceneErrorBoundary>
      </div>

      <div className="atmosphere" aria-hidden="true" />
      <div className="scanline" aria-hidden="true" />

      <Interface
        clips={clips}
        animationStates={animationStates}
        onAnimationToggle={handleAnimationToggle}
        playbackSpeed={playbackSpeed}
        onSpeedChange={setPlaybackSpeed}
        autoRotate={autoRotate}
        onAutoRotate={() => setAutoRotate((value) => !value)}
        lightingMode={lightingMode}
        onLightingMode={() =>
          setLightingMode((value) => (value === 'studio' ? 'stealth' : 'studio'))
        }
        onViewChange={handleViewChange}
        onFullscreen={handleFullscreen}
        isPanelOpen={isPanelOpen}
        manualFlight={manualFlight}
        aircraftMotionEnabled={aircraftMotionEnabled}
        onAircraftMotionToggle={() =>
          setAircraftMotionEnabled((enabled) => !enabled)
        }
        flightInput={flightInput}
        throttle={throttle}
        afterburner={afterburner}
        onManualFlightChange={handleManualFlightChange}
        onFlightInput={handleFlightInput}
        onThrottleChange={handleThrottleChange}
        onAfterburnerToggle={handleAfterburnerToggle}
        onFlightReset={handleFlightReset}
        onPanelOpen={() => setIsPanelOpen(true)}
        onPanelClose={() => setIsPanelOpen(false)}
      />

      <LoaderScreen mode="viewer" />
    </>
  )
}
