import { useEffect, useRef } from 'react'

// Key code -> semantic control. Surfaces read the control names, never the key codes,
// so a second pilot in a dogfight only needs a second binding map.
export const FLIGHT_BINDINGS = {
  ArrowUp: 'pitch-up',
  ArrowDown: 'pitch-down',
  ArrowLeft: 'roll-left',
  ArrowRight: 'roll-right',
  KeyQ: 'yaw-left',
  KeyE: 'yaw-right',
  KeyW: 'throttle-up',
  KeyS: 'throttle-down',
  KeyF: 'flaps',
  ShiftLeft: 'afterburner',
  ShiftRight: 'afterburner',
}

function axis(pressed, positive, negative) {
  return Number(pressed.has(positive)) - Number(pressed.has(negative))
}

// The four attitude axes, each -1..1, as the control surfaces want them.
export function readAxes(pressed) {
  return {
    pitch: axis(pressed, 'pitch-up', 'pitch-down'),
    roll: axis(pressed, 'roll-right', 'roll-left'),
    yaw: axis(pressed, 'yaw-right', 'yaw-left'),
    flaps: Number(pressed.has('flaps')),
  }
}

export function readThrottleDirection(pressed) {
  return axis(pressed, 'throttle-up', 'throttle-down')
}

// Reheat is held, not latched: this only reports that the pilot is asking for it. Whether
// the burner actually lights is the flight model's answer, not the keyboard's.
export function readAfterburnerCommand(pressed) {
  return pressed.has('afterburner')
}

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
*/
export default function useFlightControls({
  bindings = FLIGHT_BINDINGS,
  throttle = 0,
  onPress,
  onChange,
  keyActions,
} = {}) {
  const controls = useRef({ pressed: new Set(), throttle })
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
        if (fieldFocused) return
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
      if (!pressed.size) return
      pressed.clear()
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
  }, [bindings])

  return controls
}
