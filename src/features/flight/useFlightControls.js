import { useEffect, useRef } from 'react'

import {
  FLIGHT_BINDINGS,
  createFlightInputState,
  releaseFlightInput,
} from './flightInput'

export {
  FLIGHT_BINDINGS,
  clearAnalogFlightInput,
  createFlightInputState,
  readAfterburnerCommand,
  readAirBrake,
  readAxes,
  readThrottleDirection,
  releaseFlightInput,
  resetFlightInput,
  setAnalogFlightInput,
  stepFlightInput,
} from './flightInput'

function isFieldFocused(event) {
  const target = event.target instanceof HTMLElement ? event.target : null
  return Boolean(target?.closest('input, textarea, select, [contenteditable="true"]'))
}

/*
Holds pilot input in a ref rather than React state: the render loop reads it every
frame, and a dogfight will read two of these per frame. Only the surfaces that show
input in the DOM re-render, and they do it from onChange.

  controls.current = { pressed: Set<controlName>, throttle: number }

Every binding is a held control, including the afterburner: the pilot holds it for as long
as they want the burner, and releasing is what shuts it down. Nothing here latches.

`keyActions` handles the keys that are events rather than held axes (reset, pause).
Each handler receives (event, { fieldFocused }) and does its own preventDefault.

`paused` mutes every held binding without unmounting anything. It has to: the flight
bindings swallow Space and the arrows, so a pause menu whose buttons are focusable would
otherwise deploy the air brake instead of being pressed. `keyActions` still runs, because
the key that opens the menu is also the key that closes it.
*/
export default function useFlightControls({
  bindings = FLIGHT_BINDINGS,
  throttle = 0,
  onPress,
  onChange,
  keyActions,
  paused = false,
} = {}) {
  const controls = useRef(null)
  if (!controls.current) controls.current = createFlightInputState(throttle)
  const handlers = useRef({})
  handlers.current = { onPress, onChange, keyActions }

  useEffect(() => {
    const pressed = controls.current.pressed

    const onKeyDown = (event) => {
      const fieldFocused = isFieldFocused(event)
      const control = bindings[event.code]

      if (control) {
        // Arrows and W/S belong to the throttle slider while it has focus, and to any
        // text field. Everywhere else they fly the aircraft — including on a button,
        // which is exactly where focus lands after the pilot taps a flight pad key.
        // A paused sortie hands them all back to the menu, un-prevented.
        if (fieldFocused || paused) return
        // Repeats have to be swallowed too, or a held arrow key scrolls the page.
        event.preventDefault()
        if (pressed.has(control)) return
        pressed.add(control)
        handlers.current.onPress?.(control, event)
        handlers.current.onChange?.(pressed)
        return
      }

      handlers.current.keyActions?.[event.code]?.(event, { fieldFocused })
    }

    const onKeyUp = (event) => {
      const control = bindings[event.code]
      if (!control || !pressed.has(control)) return
      event.preventDefault()
      pressed.delete(control)
      handlers.current.onChange?.(pressed)
    }

    // A window that loses focus never delivers the keyup, which would leave the stick
    // deflected for as long as the pilot is away.
    const releaseAll = () => {
      if (!pressed.size && !controls.current.analog.size) return
      releaseFlightInput(controls.current)
      handlers.current.onChange?.(pressed)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', releaseAll)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', releaseAll)
      releaseAll()
    }
    // Re-subscribing on a pause is deliberate: the cleanup's releaseAll is what lets go of
    // the stick the pilot was holding when they hit the menu, and it keeps the throttle.
  }, [bindings, paused])

  return controls
}
