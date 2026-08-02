/*
THESIS: A radar test cell where the aircraft, not dashboard chrome, is the instrument.
OWN-WORLD: Carbon black, cold steel type, ice-blue illumination, and one restrained amber signal.
STORY: The viewer sees the complete Raptor, explores its airframe, then controls every embedded motion sequence.
FIRST VIEWPORT: Full-bleed 3D aircraft, sparse identity at left, controls at right, and a low cinematic transport rail.
FORM: Radar-scope test cell, direction 6/7, immersive center stage, seed 83862736.
*/

import { useCallback, useEffect, useRef, useState } from 'react'
import Interface from './components/Interface'
import LoaderScreen from './components/LoaderScreen'
import Scene from './components/Scene'
import SceneErrorBoundary from './components/SceneErrorBoundary'

export default function App() {
  const [clips, setClips] = useState([])
  const [animationStates, setAnimationStates] = useState({})
  const [isPlaying, setIsPlaying] = useState(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [currentTime, setCurrentTime] = useState(0)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [autoRotate, setAutoRotate] = useState(false)
  const [lightingMode, setLightingMode] = useState('studio')
  const [seekRequest, setSeekRequest] = useState(null)
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
  const pressedFlightKeys = useRef(new Set())
  const manualFlightRef = useRef(manualFlight)
  manualFlightRef.current = manualFlight

  const animationDuration = Math.max(0, ...clips.map((clip) => clip.duration))

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

  const handleSeek = useCallback((time) => {
    setCurrentTime(time)
    setSeekRequest({ time, id: performance.now() })
  }, [])

  const handleRestart = useCallback(() => {
    handleSeek(0)
    setIsPlaying(true)
  }, [handleSeek])

  const handleViewChange = useCallback((view) => {
    setViewRequest({ view, id: performance.now() })
    setIsPanelOpen(false)
  }, [])

  const handleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch {
      // Fullscreen may be blocked by an embedded browser; the viewer remains usable.
    }
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

  useEffect(() => {
    const syncFlightKeys = () => {
      const keys = pressedFlightKeys.current
      setFlightInput({
        pitch: Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown')),
        roll: Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft')),
        yaw: Number(keys.has('KeyE')) - Number(keys.has('KeyQ')),
        flaps: Number(keys.has('KeyF')),
      })
    }

    const onKeyDown = (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      // Arrows and W/S belong to the throttle slider while it has focus, and to any text
      // field. Everywhere else they fly the aircraft — including on a button, which is
      // exactly where focus lands after the pilot taps the Flight tab or a flight pad key.
      const isFieldFocused = Boolean(
        target?.closest('input, textarea, select, [contenteditable="true"]'),
      )

      const flightKeys = [
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'KeyQ',
        'KeyE',
        'KeyF',
        'KeyW',
        'KeyS',
      ]

      if (flightKeys.includes(event.code)) {
        if (isFieldFocused) return
        event.preventDefault()
        if (!pressedFlightKeys.current.has(event.code)) {
          pressedFlightKeys.current.add(event.code)
          setManualFlight(true)
          setAutoRotate(false)
          setIsPlaying(false)
          syncFlightKeys()
        }
        return
      }

      if (event.code === 'Space') {
        // Space still activates whatever control has focus rather than dropping flight mode.
        if (isFieldFocused || target?.closest('button')) return
        event.preventDefault()
        if (manualFlightRef.current) {
          setManualFlight(false)
          setAfterburner(false)
          setFlightInput({ pitch: 0, roll: 0, yaw: 0, flaps: 0 })
          setIsPlaying(true)
        } else {
          setIsPlaying((value) => !value)
        }
      }
      if (event.key.toLowerCase() === 'r' && !isFieldFocused) {
        handleViewChange('perspective')
      }
    }

    const onKeyUp = (event) => {
      if (!pressedFlightKeys.current.has(event.code)) return
      event.preventDefault()
      pressedFlightKeys.current.delete(event.code)
      syncFlightKeys()
    }

    const releaseFlightKeys = () => {
      pressedFlightKeys.current.clear()
      setFlightInput({ pitch: 0, roll: 0, yaw: 0, flaps: 0 })
    }

    const throttleTimer = window.setInterval(() => {
      const keys = pressedFlightKeys.current
      const direction = Number(keys.has('KeyW')) - Number(keys.has('KeyS'))
      if (!direction) return

      setThrottle((value) => {
        const nextThrottle = Math.min(1, Math.max(0, value + (direction * 0.025)))
        if (nextThrottle < 0.65) setAfterburner(false)
        return nextThrottle
      })
    }, 50)

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', releaseFlightKeys)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', releaseFlightKeys)
      window.clearInterval(throttleTimer)
    }
  }, [handleViewChange])

  return (
    <main className="viewer-shell">
      <div
        className="canvas-stage"
        onDoubleClick={() => handleViewChange('perspective')}
      >
        <SceneErrorBoundary>
          <Scene
            animationStates={animationStates}
            isPlaying={isPlaying}
            playbackSpeed={playbackSpeed}
            seekRequest={seekRequest}
            autoRotate={autoRotate}
            viewRequest={viewRequest}
            lightingMode={lightingMode}
            manualFlight={manualFlight}
            aircraftMotionEnabled={aircraftMotionEnabled}
            flightInput={flightInput}
            flightResetId={flightResetId}
            onClipsReady={handleClipsReady}
            onTimeUpdate={setCurrentTime}
          />
        </SceneErrorBoundary>
      </div>

      <div className="atmosphere" aria-hidden="true" />
      <div className="scanline" aria-hidden="true" />

      <Interface
        clips={clips}
        animationStates={animationStates}
        onAnimationToggle={handleAnimationToggle}
        isPlaying={isPlaying}
        onPlayPause={() => setIsPlaying((value) => !value)}
        currentTime={currentTime}
        duration={animationDuration}
        onSeek={handleSeek}
        playbackSpeed={playbackSpeed}
        onSpeedChange={setPlaybackSpeed}
        autoRotate={autoRotate}
        onAutoRotate={() => setAutoRotate((value) => !value)}
        lightingMode={lightingMode}
        onLightingMode={() =>
          setLightingMode((value) => (value === 'studio' ? 'stealth' : 'studio'))
        }
        onViewChange={handleViewChange}
        onRestart={handleRestart}
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

      <LoaderScreen />
    </main>
  )
}
