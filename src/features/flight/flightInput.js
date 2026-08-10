/*
Device-neutral pilot input.

Device adapters only hold semantic actions or publish analogue axes. The flight loop calls
`stepFlightInput` once per rendered frame and receives one continuous intent object. Physics
never needs to know whether pitch came from an arrow key, a gamepad, a pointer, or a touch
control.

`pressed` remains public because the HUD and the manoeuvre bot are device adapters too: they
hold the exact same actions as the keyboard. Analogue sources are kept separately and mixed
by strongest deflection so adding a gamepad cannot make keyboard controls fight it.
*/

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
  KeyV: 'rear-view',
  ShiftLeft: 'afterburner',
  ShiftRight: 'afterburner',
  Space: 'maneuver-assist',
}

const AXES = ['pitch', 'roll', 'yaw']

const RESPONSE = {
  pitch: { engage: 4.6, release: 7.5 },
  roll: { engage: 5.5, release: 8.5 },
  yaw: { engage: 3.8, release: 6.5 },
  flaps: { engage: 5, release: 7 },
  airBrake: { engage: 5, release: 8 },
}

function clampAxis(value) {
  return Math.max(-1, Math.min(1, Number(value) || 0))
}

function moveToward(current, target, amount) {
  if (current < target) return Math.min(current + amount, target)
  if (current > target) return Math.max(current - amount, target)
  return target
}

function smoothAxis(current, target, response, step) {
  const returning = target === 0 || Math.sign(target) !== Math.sign(current)
    || Math.abs(target) < Math.abs(current)
  return moveToward(current, target, (returning ? response.release : response.engage) * step)
}

function digitalAxis(pressed, positive, negative) {
  return Number(pressed.has(positive)) - Number(pressed.has(negative))
}

function strongestAxis(state, axis, digital) {
  let resolved = digital
  for (const source of state.analog.values()) {
    const candidate = clampAxis(source[axis])
    if (Math.abs(candidate) > Math.abs(resolved)) resolved = candidate
  }
  return resolved
}

export function readAxes(pressed) {
  return {
    pitch: digitalAxis(pressed, 'pitch-up', 'pitch-down'),
    roll: digitalAxis(pressed, 'roll-right', 'roll-left'),
    yaw: digitalAxis(pressed, 'yaw-right', 'yaw-left'),
    flaps: Number(pressed.has('flaps')),
  }
}

export function readThrottleDirection(pressed) {
  return digitalAxis(pressed, 'throttle-up', 'throttle-down')
}

export function readAccelerate(pressed) {
  return pressed.has('throttle-up') && !pressed.has('throttle-down')
}

// PSM stays deliberate instead of opening during an ordinary slow, hard turn. Device
// adapters may put this intent on an ergonomic single key, a trigger chord, or a touch pad.
export function readPsmArm(pressed) {
  return pressed.has('maneuver-assist')
}

export function readAfterburnerCommand(pressed) {
  return pressed.has('afterburner')
}

export function readAirBrake(pressed, pitch = 0, envelope = {}) {
  // A dedicated air-brake action remains available for future HOTAS adapters, but the
  // default arcade control speaks in intent: S means slow down, so it reduces power and
  // progressively opens the brake. A committed pull gets the full brake for a high-G turn.
  if (pressed.has('air-brake')) return 1
  if (!pressed.has('throttle-down')) return 0

  const deceleration = envelope.deceleration ?? {}
  const fullBrakePitch = deceleration.fullBrakePitch ?? 0.72
  if (pitch >= fullBrakePitch) return 1
  return Math.max(0, Math.min(1, deceleration.airBrakeLevel ?? 0.65))
}

export function createFlightInputState(throttle = 0) {
  return {
    pressed: new Set(),
    analog: new Map(),
    cameraLook: {
      active: false,
      yaw: 0,
      pitch: 0,
    },
    throttle,
    intent: {
      pitch: 0,
      roll: 0,
      yaw: 0,
      flaps: 0,
      throttle,
      airBrake: 0,
      afterburner: false,
      accelerate: false,
      psmArm: false,
    },
  }
}

export function setAnalogFlightInput(state, source, axes = {}) {
  const next = {}
  for (const axis of AXES) next[axis] = clampAxis(axes[axis])
  state.analog.set(source, next)
}

export function clearAnalogFlightInput(state, source) {
  state.analog.delete(source)
}

export function releaseFlightInput(state) {
  state.pressed.clear()
  state.analog.clear()
  state.cameraLook.active = false
}

export function resetFlightInput(state, throttle = state.throttle) {
  releaseFlightInput(state)
  state.throttle = throttle
  state.intent.pitch = 0
  state.intent.roll = 0
  state.intent.yaw = 0
  state.intent.flaps = 0
  state.intent.throttle = throttle
  state.intent.airBrake = 0
  state.intent.afterburner = false
  state.intent.accelerate = false
  state.intent.psmArm = false
  return state
}

export function stepFlightInput(state, step, envelope) {
  const raw = readAxes(state.pressed)
  const targets = {
    pitch: strongestAxis(state, 'pitch', raw.pitch),
    roll: strongestAxis(state, 'roll', raw.roll),
    yaw: strongestAxis(state, 'yaw', raw.yaw),
  }

  for (const axis of AXES) {
    state.intent[axis] = smoothAxis(
      state.intent[axis],
      targets[axis],
      RESPONSE[axis],
      step,
    )
  }

  state.intent.flaps = smoothAxis(
    state.intent.flaps,
    raw.flaps,
    RESPONSE.flaps,
    step,
  )
  state.intent.airBrake = smoothAxis(
    state.intent.airBrake,
    readAirBrake(state.pressed, targets.pitch, envelope),
    RESPONSE.airBrake,
    step,
  )
  state.intent.afterburner = readAfterburnerCommand(state.pressed)
  state.intent.accelerate = readAccelerate(state.pressed)
  state.intent.psmArm = readPsmArm(state.pressed)

  state.throttle = Math.max(envelope.minThrottle, Math.min(
    1,
    state.throttle
      + (readThrottleDirection(state.pressed) * step * envelope.throttleRate),
  ))
  state.intent.throttle = state.throttle

  return state.intent
}
