import { useCallback, useMemo, useRef, useState } from 'react'

import { getAircraft } from '../../aircraft'
import { getMap } from '../../maps'
import { createTelemetry } from './telemetry'
import useFlightControls from './useFlightControls'

/*
Everything a flight surface needs before it has drawn anything: which map and which
airframe, the control ref the keyboard writes into, the telemetry object the scene fills
and the HUD reads, and the reset and debug toggles.

Both the sortie and the observer page mount this, which is what keeps their key bindings,
their reset semantics and their telemetry contract identical. A surface that wants extra
keys passes them in `extraKeys`; it never re-declares the ones every flight surface has.
*/
export default function useFlightSession({ mapId, aircraftId, extraKeys } = {}) {
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
      event.preventDefault()
      setResetId((value) => value + 1)
    },
    KeyI: (event, { fieldFocused }) => {
      if (fieldFocused) return
      event.preventDefault()
      setDebug((value) => !value)
    },
    ...extraKeys,
  }), [extraKeys])

  const controls = useFlightControls({ throttle: envelope.idleThrottle, keyActions })

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
