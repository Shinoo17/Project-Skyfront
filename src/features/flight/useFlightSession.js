import { useCallback, useMemo, useRef, useState } from 'react'

import { getAircraft } from '../../aircraft'
import { getMap } from '../../maps'
import { readTargetAirspeedKmh } from './performance'
import { createTelemetry } from './telemetry'
import useFlightControls from './useFlightControls'

/*
Everything a flight surface needs before it has drawn anything: which map and which
airframe, the control ref the keyboard writes into, the telemetry object the scene fills
and the HUD reads, and the reset and debug toggles.

Both the sortie and the observer page mount this, which is what keeps their key bindings,
their reset semantics and their telemetry contract identical. A surface that wants extra
keys passes them in `extraKeys`; it never re-declares the ones every flight surface has.

`paused` is the surface saying the pilot is in a menu: held controls stop being read and
are let go of, while the event keys keep working so the menu can be closed again. Surfaces
that never pause simply do not pass it.
*/
export default function useFlightSession({ mapId, aircraftId, extraKeys, paused = false } = {}) {
  const aircraft = getAircraft(aircraftId)
  const map = getMap(mapId)
  const envelope = aircraft.flight.envelope

  const [resetId, setResetId] = useState(0)
  // The debug overlay is a real toggle, not a held control: it changes a handful of times
  // per session, so it is the rare piece of flight UI that belongs in React state.
  const [debug, setDebug] = useState(false)

  // One object, mutated in place by the flight loop and read by the HUD's own animation
  // frame. Flight state never becomes React state, so a 60 Hz range renders React zero
  // times a second.
  const telemetry = useRef(createTelemetry())

  const reset = useCallback(() => setResetId((value) => value + 1), [])

  const keyActions = useMemo(() => ({
    KeyR: (event) => {
      // A reset asked for behind a menu would only land on the frame the pilot resumes,
      // which is not what pressing it looked like it did.
      if (paused) return
      event.preventDefault()
      setResetId((value) => value + 1)
    },
    KeyI: (event, { fieldFocused }) => {
      if (fieldFocused) return
      event.preventDefault()
      setDebug((value) => !value)
    },
    ...extraKeys,
  }), [extraKeys, paused])

  // Seeded at the band the range actually flies in so the HUD reads a real commanded speed
  // on its first frame. FlightAircraft re-seeds it from the map's own spawn altitude the
  // moment it mounts, which is what a map spawning lower down needs.
  const controls = useFlightControls({
    commandSpeedKmh: readTargetAirspeedKmh(
      envelope.idleThrottle,
      envelope.performance.highAltitude.worldUnits,
      0,
      envelope,
    ),
    keyActions,
    paused,
  })

  return {
    aircraft,
    map,
    envelope,
    controls,
    telemetry,
    resetId,
    reset,
    debug,
    setDebug,
  }
}
