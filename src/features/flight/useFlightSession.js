import { useCallback, useMemo, useRef, useState } from 'react'

import { getAircraft } from '../../aircraft'
import { getMap } from '../../maps'
import { readThrottlePower } from './performance'
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
export default function useFlightSession({
  mapId,
  aircraftId,
  extraKeys,
  // The pilot's own keyboard, already flattened to the `code → control` map the input layer
  // reads. Surfaces that have no rebind screen pass nothing and fly the authored defaults.
  bindings,
  paused = false,
} = {}) {
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

  /*
  The reset has no key. It used to own R, and R is worth more as rear view: the reset is
  pressed a handful of times a sortie and is reachable from the deck and from the pause
  menu, while a look behind is held constantly and wants a key under the hand. Nothing here
  refuses the reset — `reset` below is what the two buttons call.
  */
  const keyActions = useMemo(() => ({
    KeyI: (event, { fieldFocused }) => {
      if (fieldFocused) return
      event.preventDefault()
      setDebug((value) => !value)
    },
    ...extraKeys,
  }), [extraKeys])

  // Seed the player intent at the aircraft's authored cruise power. Spawn speed is derived
  // from that trim at the map altitude by FlightAircraft; live speed never is.
  const controls = useFlightControls({
    initialCommandedThrottle: readThrottlePower(envelope.idleThrottle, envelope),
    bindings,
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
