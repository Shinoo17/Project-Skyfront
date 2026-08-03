import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'

import { createBotStatus } from './botStatus'

/*
An autopilot that flies a script by holding the pilot's own controls.

It writes into `controls.current.pressed` — the same set the keyboard writes into — and
nothing else. It cannot reach the flight model, it has no privileged inputs, and it is
subject to every limiter and every energy cost a person is. That is what makes a
demonstration worth watching: if the airframe cannot do the thing, the bot cannot fake it.

It runs at a negative `useFrame` priority so the inputs are in place before the flight loop
reads them in the same frame, and it never calls `setState` from that loop except to ask
the surface for a reset. Progress goes into `status`, a plain ref the panel reads from its
own animation frame.

A run is: set the entry throttle, ask for a reset (the aircraft respawns at whatever speed
that throttle holds, so every run starts identically), wait for the reset to land, settle,
then walk the steps. A reset the bot did not ask for — the range floor, the range edge, the
ceiling — restarts the script rather than leaving it flying a timeline against a state that
no longer matches it.
*/

// Before OrbitControls' damping pass and well before the flight loop at 0.
const BOT_PRIORITY = -2

function releaseControls(controls) {
  const pressed = controls?.current?.pressed
  if (pressed && pressed.size) pressed.clear()
}

export default function ManeuverBot({
  maneuver,
  controls,
  telemetry,
  status,
  loop = false,
  onRequestReset,
  onFinished,
}) {
  const run = useRef({
    timeline: null,
    phase: 'idle',
    stepIndex: 0,
    stepElapsed: 0,
    elapsed: 0,
    waited: 0,
    previousSinceReset: 0,
  })

  // Arming happens here rather than in the frame loop: starting a run is a discrete event,
  // and the entry throttle has to be set before the reset is asked for, because the spawn
  // airspeed is read off the throttle.
  useEffect(() => {
    const state = run.current
    if (!maneuver) {
      state.phase = 'idle'
      state.timeline = null
      releaseControls(controls)
      Object.assign(status.current, createBotStatus(), {
        runs: status.current.runs,
        restarts: status.current.restarts,
      })
      return undefined
    }

    state.timeline = [
      { seconds: maneuver.entry.settleSeconds, hold: [], label: 'SETTLE' },
      ...maneuver.steps,
    ]
    state.phase = 'arm'
    state.stepIndex = 0
    state.stepElapsed = 0
    state.elapsed = 0
    state.waited = 0

    Object.assign(status.current, {
      phase: 'arm',
      stepLabel: 'ARMING',
      stepIndex: -1,
      stepCount: state.timeline.length,
      elapsed: 0,
      total: state.timeline.reduce((sum, step) => sum + step.seconds, 0),
      expect: maneuver.expect ?? null,
      matchedSeconds: 0,
      matched: false,
    })

    return () => releaseControls(controls)
  }, [controls, maneuver, status])

  useFrame((_, delta) => {
    const state = run.current
    if (!maneuver || !state.timeline) return
    const step = Math.min(delta, 0.1)
    const readout = status.current
    const flight = telemetry.current

    if (state.phase === 'arm') {
      controls.current.throttle = maneuver.entry.throttle
      releaseControls(controls)
      state.previousSinceReset = flight.sinceReset
      state.waited = 0
      state.phase = 'wait'
      readout.phase = 'wait'
      readout.stepLabel = 'RESETTING'
      onRequestReset?.()
      return
    }

    if (state.phase === 'wait') {
      state.waited += step
      // The reset has landed once the aircraft is flying again and the clock since the last
      // one is young. The timeout is the escape hatch for a surface that never resets.
      if ((flight.live && flight.sinceReset < 0.6) || state.waited > 2.5) {
        state.phase = 'run'
        state.stepIndex = 0
        state.stepElapsed = 0
        state.elapsed = 0
        readout.phase = 'run'
        readout.runs += 1
      }
      state.previousSinceReset = flight.sinceReset
      return
    }

    if (state.phase !== 'run') return

    // A reset nobody asked for — terrain, range edge, ceiling. The timeline no longer
    // describes the state the aircraft is in, so start the script again from the top.
    if (flight.sinceReset < state.previousSinceReset - 0.05) {
      readout.restarts += 1
      state.phase = 'arm'
      return
    }
    state.previousSinceReset = flight.sinceReset

    const current = state.timeline[state.stepIndex]
    if (!current) return

    const pressed = controls.current.pressed
    pressed.clear()
    current.hold.forEach((control) => pressed.add(control))

    state.stepElapsed += step
    state.elapsed += step
    readout.elapsed = state.elapsed
    readout.stepLabel = current.label
    readout.stepIndex = state.stepIndex
    readout.observed = flight.maneuver
    if (readout.expect && flight.maneuver === readout.expect) {
      readout.matchedSeconds += step
      readout.matched = true
    }

    if (state.stepElapsed < current.seconds) return

    state.stepElapsed = 0
    state.stepIndex += 1
    if (state.stepIndex < state.timeline.length) return

    releaseControls(controls)
    if (loop) {
      state.phase = 'arm'
      return
    }
    state.phase = 'done'
    readout.phase = 'done'
    readout.stepLabel = 'COMPLETE'
    onFinished?.()
  }, BOT_PRIORITY)

  useEffect(() => () => releaseControls(controls), [controls])

  return null
}
